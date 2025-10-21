import prisma from '../db';
import { llmService } from './llm.service';
import { graphService, EntityLinkWithEntities } from './graph.service';

interface Implication {
  type: 'action_suggestion' | 'connection' | 'gap' | 'contradiction';
  content: string;
  relatedMemories: string[];
  confidence: number;
  reasoning: string;
  temporal: {
    isRecent: boolean;
    isCurrent: boolean;
  };
}

interface Event {
  date: Date;
  type: string;
  description: string;
  memoryId: string;
  entities: string[];
  confidence: number;
}

interface KnowledgeGap {
  entity: string;
  mentionCount: number;
  questionCount: number;
  hasDefinition: boolean;
  definitionQuality: number;
  suggestion: string;
  priority: number;
}

export class ReasoningService {

  /**
   * Enhanced implication detection with temporal awareness and validation
   */
  async detectImplications(
    userId: string,
    contextMemories: any[],
    currentQuery: string
  ): Promise<Implication[]> {
    if (contextMemories.length < 2) {
      return [];
    }

    // Step 1: Filter and rank memories by relevance
    const rankedMemories = await this.rankMemoriesByRelevance(
      contextMemories,
      currentQuery,
      15 // Top 15 most relevant
    );

    // Step 2: Detect contradictions
    const contradictions = await this.detectContradictions(rankedMemories);

    // Step 3: Group by temporal relevance
    const { recent, historical } = this.groupByTemporalRelevance(rankedMemories);

    // Step 4: Deduplicate similar memories
    const deduplicated = await this.deduplicateMemories(recent);

    // Step 5: Format for LLM with temporal context
    const memoriesText = deduplicated
      .map((m, i) => {
        const age = this.getMemoryAge(m);
        const confidenceTag = m.confidenceScore < 0.5 ? '[LOW_CONFIDENCE]' : '';
        return `[${i}] ${confidenceTag} (${age}) ${m.content}`;
      })
      .join('\n');

    const prompt = `Given the following memories about a user and their current query, identify logical implications, connections, or action suggestions.

USER'S MEMORIES (ordered by relevance, with recency tags):
${memoriesText}

${contradictions.length > 0 ? `\nDETECTED CONTRADICTIONS:\n${contradictions.map(c => `- ${c}`).join('\n')}\n` : ''}

CURRENT QUERY: "${currentQuery}"

Task: Analyze these memories and identify:
1. ACTION SUGGESTIONS: Concrete actions the user might need to take (must be actionable and specific)
2. CONNECTIONS: Non-obvious relationships between memories that provide insight
3. GAPS: Important missing information that would help answer the query
4. CONTRADICTIONS: Conflicting information that needs resolution

Important rules:
- Consider temporal context: recent memories are more relevant than old ones
- Lower confidence for implications based on low-confidence memories
- If memories contradict each other, note this and suggest the most recent information
- Only suggest actions that are actually possible based on available information
- Avoid restating obvious facts

Respond in JSON format:
{
  "implications": [
    {
      "type": "action_suggestion" | "connection" | "gap" | "contradiction",
      "content": "<the implication or suggestion>",
      "relatedMemoryIndices": [<indices of relevant memories>],
      "confidence": <0.0-1.0>,
      "reasoning": "<brief explanation of why this implication exists>",
      "isTimeSensitive": <true if involves recent/current info>
    }
  ]
}

Only include implications with confidence > 0.5 that are genuinely useful.`;

    try {
      const response = await llmService.generateCompletion(prompt);
      const parsed = JSON.parse(this.extractJSON(response));

      // Step 6: Validate and enrich implications
      const implications: Implication[] = [];

      for (const imp of parsed.implications) {
        // Validate memory indices
        if (!this.validateMemoryIndices(imp.relatedMemoryIndices, deduplicated.length)) {
          continue;
        }

        // Calculate adjusted confidence
        const adjustedConfidence = this.calculateImplicationConfidence(
          imp,
          deduplicated,
          contradictions
        );

        if (adjustedConfidence < 0.5) {
          continue;
        }

        // Validate implication content
        if (!await this.validateImplication(imp, deduplicated, userId)) {
          continue;
        }

        implications.push({
          type: imp.type,
          content: imp.content,
          relatedMemories: imp.relatedMemoryIndices.map((idx: number) => deduplicated[idx].id),
          confidence: adjustedConfidence,
          reasoning: imp.reasoning || 'No reasoning provided',
          temporal: {
            isRecent: imp.isTimeSensitive || false,
            isCurrent: this.isCurrentlyRelevant(imp.relatedMemoryIndices, deduplicated)
          }
        });
      }

      // Step 7: Remove duplicate implications
      return this.deduplicateImplications(implications);

    } catch (error) {
      console.error('Error in detectImplications:', error);
      return [];
    }
  }

  /**
   * Enhanced knowledge gap detection with semantic understanding
   */
  async identifyKnowledgeGaps(userId: string): Promise<KnowledgeGap[]> {
    const memories = await prisma.memory.findMany({
      where: {
        userId,
        deleted: false,
        confidenceScore: { gt: 0.3 }
      },
      select: {
        id: true,
        content: true,
        metadata: true,
        type: true,
        recordedAt: true,
        createdAt: true
      },
      orderBy: { recordedAt: 'desc' }
    });

    // Track entity mentions and contexts
    const entityStats = new Map<string, {
      mentions: number;
      questionContexts: number;
      definitionContexts: number;
      implicitKnowledge: number;
      lastMentioned: Date;
      examples: string[];
    }>();

    for (const memory of memories) {
      const entities = (memory.metadata as any)?.detected_entities || [];
      const content = memory.content.toLowerCase();
      const isQuestion = memory.type === 'question' || content.includes('what is') || content.includes('who is');
      
      for (const entity of entities) {
        const entityLower = entity.toLowerCase();
        const stats: { // Explicitly type stats to ensure 'examples' is string[]
          mentions: number;
          questionContexts: number;
          definitionContexts: number;
          implicitKnowledge: number;
          lastMentioned: Date;
          examples: string[];
        } = entityStats.get(entity) || {
          mentions: 0,
          questionContexts: 0,
          definitionContexts: 0,
          implicitKnowledge: 0,
          lastMentioned: memory.recordedAt || memory.createdAt,
          examples: [] as string[] // Explicitly cast as string[]
        };

        stats.mentions++;
        stats.lastMentioned = memory.recordedAt || memory.createdAt;

        // Check if this is a question context
        if (isQuestion && content.includes(entityLower)) {
          stats.questionContexts++;
        }

        // Check for definition patterns (more sophisticated)
        if (this.hasDefinitionPattern(content, entityLower)) {
          stats.definitionContexts++;
        }

        // Check for implicit knowledge (entity used in context that assumes understanding)
        if (this.hasImplicitKnowledge(content, entityLower)) {
          stats.implicitKnowledge++;
        }

        // Store example
        if (stats.examples.length < 3) {
          stats.examples.push(memory.content.substring(0, 100));
        }

        entityStats.set(entity, stats);
      }
    }

    // Calculate gap scores
    const gaps: KnowledgeGap[] = [];

    for (const [entity, stats] of entityStats.entries()) {
      const definitionQuality = stats.definitionContexts / Math.max(stats.mentions, 1);
      
      // Gap score calculation
      const gapScore = (
        stats.mentions * 0.2 + 
        stats.questionContexts * 0.5 + 
        (stats.definitionContexts === 0 ? 1.0 : 0) * 0.3 - 
        definitionQuality * 0.4 - 
        stats.implicitKnowledge * 0.1
      );

      // Recency boost: gaps in recently mentioned entities are more important
      const daysSinceLastMention = (Date.now() - stats.lastMentioned.getTime()) / (1000 * 60 * 60 * 24);
      const recencyBoost = Math.exp(-daysSinceLastMention / 30);
      const finalScore = gapScore * (1 + recencyBoost);

      if (finalScore > 0.5 && stats.mentions >= 2) {
        gaps.push({
          entity,
          mentionCount: stats.mentions,
          questionCount: stats.questionContexts,
          hasDefinition: stats.definitionContexts > 0,
          definitionQuality,
          suggestion: this.generateGapSuggestion(entity, stats),
          priority: finalScore
        });
      }
    }

    return gaps.sort((a, b) => b.priority - a.priority).slice(0, 10);
  }

  /**
   * Enhanced timeline building with event extraction and causal analysis
   */
  async buildTimeline(
    userId: string,
    entityName: string
  ): Promise<{ 
    entity: string;
    timeline: Event[];
    narrative: string;
    phases: Array<{ name: string; period: string; summary: string }>;
    currentState: string;
  }> {
    // Get all memories mentioning this entity
    const memories = await prisma.memory.findMany({
      where: {
        userId,
        deleted: false,
        content: {
          contains: entityName,
          mode: 'insensitive'
        }
      },
      orderBy: { recordedAt: 'asc' },
      select: {
        id: true,
        content: true,
        recordedAt: true,
        createdAt: true,
        type: true,
        metadata: true,
        confidenceScore: true
      }
    });

    if (memories.length === 0) {
      return {
        entity: entityName,
        timeline: [],
        narrative: `No memories found about ${entityName}.`,
        phases: [],
        currentState: 'Unknown'
      };
    }

    // Extract events from each memory
    const events = await this.extractEventsFromMemories(memories, entityName);

    // Detect contradictions and resolve them
    const resolvedEvents = this.resolveConflictingEvents(events);

    // Identify causal relationships
    const eventsWithCausality = this.identifyCausalRelationships(resolvedEvents);

    // Detect phases (groups of related events)
    const phases = this.identifyPhases(eventsWithCausality);

    // Generate narrative with structure
    const narrative = await this.generateStructuredNarrative(
      entityName,
      eventsWithCausality,
      phases
    );

    // Determine current state
    const currentState = await this.determineCurrentState(
      entityName,
      eventsWithCausality,
      userId
    );

    return {
      entity: entityName,
      timeline: eventsWithCausality,
      narrative,
      phases,
      currentState
    };
  }

  /**
   * Enhanced graph reasoning with multi-hop traversal and semantic understanding
   */
  async graphReasoning(
    userId: string,
    query: string
  ): Promise<{ 
    reasoning: string;
    relevantPaths: Array<{ 
      path: string[];
      explanation: string;
      strength: number;
    }>;
    entities: string[];
  }> {
    // Step 1: Classify query intent
    const queryIntent = await this.classifyQueryIntent(query);

    if (!queryIntent.isConnectionQuery) {
      return { reasoning: '', relevantPaths: [], entities: [] };
    }

    // Step 2: Extract entities from query
    const entities = await prisma.entity.findMany({
      where: { userId },
      select: { id: true, name: true, type: true }
    });

    const mentionedEntities = entities.filter((e:any) =>
      query.toLowerCase().includes(e.name.toLowerCase())
    );

    if (mentionedEntities.length === 0) {
      return { reasoning: '', relevantPaths: [], entities: [] };
    }

    // Step 3: Different strategies based on query type
    let paths: Array<{ path: string[]; explanation: string; strength: number }> = [];

    if (queryIntent.type === 'who_can_help') {
      paths = await this.findHelpPaths(userId, mentionedEntities, query);
    } else if (queryIntent.type === 'relationship_between') {
      paths = await this.findRelationshipPaths(userId, mentionedEntities);
    } else if (queryIntent.type === 'who_knows') {
      paths = await this.findKnowledgePaths(userId, mentionedEntities, query);
    } else {
      paths = await this.findGeneralPaths(userId, mentionedEntities);
    }

    // Step 4: Rank paths by relevance and strength
    const rankedPaths = this.rankPaths(paths, query);

    // Step 5: Generate reasoning
    const reasoning = await this.generateGraphReasoning(
      query,
      rankedPaths,
      queryIntent
    );

    return {
      reasoning,
      relevantPaths: rankedPaths.slice(0, 5),
      entities: mentionedEntities.map((e:any) => e.name)
    };
  }

  // ==================== HELPER METHODS ====================

  private async rankMemoriesByRelevance(
    memories: any[],
    query: string,
    limit: number
  ): Promise<any[]> {
    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/);

    const scored = memories.map(memory => {
      const contentLower = memory.content.toLowerCase();
      
      // Calculate relevance score
      let score = 0;
      
      // Exact query match
      if (contentLower.includes(queryLower)) {
        score += 2.0;
      }

      // Term overlap
      const termMatches = queryTerms.filter(term => 
        term.length > 2 && contentLower.includes(term)
      ).length;
      score += termMatches * 0.5;

      // Confidence boost
      score *= memory.confidenceScore || 0.7;

      // Recency boost (exponential decay)
      const daysSince = this.getDaysSince(memory.recordedAt || memory.createdAt);
      const recencyBoost = Math.exp(-daysSince / 60); // 60-day half-life
      score *= (1 + recencyBoost);

      return { memory, score };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => s.memory);
  }

  private async detectContradictions(memories: any[]): Promise<string[]> {
    const contradictions: string[] = [];
    
    // Check for opposing statements about same entities
    for (let i = 0; i < memories.length; i++) {
      for (let j = i + 1; j < memories.length; j++) {
        const mem1 = memories[i];
        const mem2 = memories[j];

        // Simple heuristic: same entities but opposite sentiment/facts
        const entities1 = (mem1.metadata as any)?.detected_entities || [];
        const entities2 = (mem2.metadata as any)?.detected_entities || [];
        
        const commonEntities = entities1.filter((e: string) => entities2.includes(e));
        
        if (commonEntities.length > 0) {
          // Check for negation patterns
          const content1 = mem1.content.toLowerCase();
          const content2 = mem2.content.toLowerCase();
          
          const negationWords = ['not', 'no longer', 'stopped', 'quit', 'left', 'ended'];
          const hasNegation1 = negationWords.some(word => content1.includes(word));
          const hasNegation2 = negationWords.some(word => content2.includes(word));
          
          if (hasNegation1 !== hasNegation2) {
            contradictions.push(
              `Possible contradiction about ${commonEntities[0]}: "${mem1.content.substring(0, 50)}"... vs "${mem2.content.substring(0, 50)}"...`
            );
          }
        }
      }
    }

    return contradictions;
  }

  private groupByTemporalRelevance(memories: any[]): { recent: any[]; historical: any[] } {
    const now = Date.now();
    const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);

    const recent = memories.filter(m => {
      const date = m.recordedAt || m.createdAt;
      return date && date.getTime() > thirtyDaysAgo;
    });

    const historical = memories.filter(m => {
      const date = m.recordedAt || m.createdAt;
      return !date || date.getTime() <= thirtyDaysAgo;
    });

    return { recent, historical };
  }

  private async deduplicateMemories(memories: any[]): Promise<any[]> {
    const unique: any[] = [];
    const seen = new Set<string>();

    for (const memory of memories) {
      // Create fingerprint based on content similarity
      const fingerprint = memory.content
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .substring(0, 50);

      if (!seen.has(fingerprint)) {
        seen.add(fingerprint);
        unique.push(memory);
      }
    }

    return unique;
  }

  private getMemoryAge(memory: any): string {
    const days = this.getDaysSince(memory.recordedAt || memory.createdAt);
    
    if (days < 1) return 'today';
    if (days < 7) return `${Math.floor(days)} days ago`;
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
    if (days < 365) return `${Math.floor(days / 30)} months ago`;
    return `${Math.floor(days / 365)} years ago`;
  }

  private getDaysSince(date: Date): number {
    return (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
  }

  private validateMemoryIndices(indices: number[], maxIndex: number): boolean {
    return indices.every(idx => idx >= 0 && idx < maxIndex);
  }

  private calculateImplicationConfidence(
    implication: any,
    memories: any[],
    contradictions: string[]
  ): number {
    let confidence = implication.confidence || 0.7;

    // Get source memories
    const sourceMemories = implication.relatedMemoryIndices.map((idx: number) => memories[idx]);

    // Average source confidence
    const avgSourceConfidence = sourceMemories.reduce(
      (sum: number, m: any) => sum + (m.confidenceScore || 0.7),
      0
    ) / sourceMemories.length;

    confidence = Math.min(confidence, avgSourceConfidence + 0.1);

    // Recency factor
    const avgDaysSince = sourceMemories.reduce(
      (sum: number, m: any) => sum + this.getDaysSince(m.recordedAt || m.createdAt),
      0
    ) / sourceMemories.length;

    const recencyFactor = Math.exp(-avgDaysSince / 90);
    confidence *= (0.7 + 0.3 * recencyFactor);

    // Contradiction penalty
    if (contradictions.length > 0) {
      confidence *= 0.8;
    }

    return Math.max(0, Math.min(1, confidence));
  }

  private async validateImplication(
    implication: any,
    memories: any[],
    userId: string
  ): Promise<boolean> {
    // Check if action suggestions are actually possible
    if (implication.type === 'action_suggestion') {
      const content = implication.content.toLowerCase();
      
      // If suggesting to contact someone, verify they exist in memories
      if (content.includes('contact') || content.includes('email') || content.includes('reach out')) {
        const nameMatch = content.match(/contact\s+(\w+)|email\s+(\w+)|reach out to\s+(\w+)/i);
        if (nameMatch) {
          const name = nameMatch[1] || nameMatch[2] || nameMatch[3];
          const entityExists = await prisma.entity.findFirst({
            where: { userId, name: { contains: name, mode: 'insensitive' } }
          });
          
          if (!entityExists) {
            return false; // Can't suggest contacting someone who doesn't exist
          }
        }
      }
    }

    // Don't allow implications that just restate memory content
    const sourceMemories = implication.relatedMemoryIndices.map((idx: number) => memories[idx]);
    const isRestatement = sourceMemories.some((m: any) => 
      m.content.toLowerCase().includes(implication.content.toLowerCase().substring(0, 30))
    );

    if (isRestatement) {
      return false;
    }

    return true;
  }

  private isCurrentlyRelevant(indices: number[], memories: any[]): boolean {
    const sourceMemories = indices.map(idx => memories[idx]);
    const avgDays = sourceMemories.reduce(
      (sum, m) => sum + this.getDaysSince(m.recordedAt || m.createdAt),
      0
    ) / sourceMemories.length;

    return avgDays < 14; // Within 2 weeks
  }

  private deduplicateImplications(implications: Implication[]): Implication[] {
    const unique: Implication[] = [];
    const seen = new Set<string>();

    for (const imp of implications) {
      const fingerprint = `${imp.type}-${imp.content.substring(0, 30)}`;
      
      if (!seen.has(fingerprint)) {
        seen.add(fingerprint);
        unique.push(imp);
      }
    }

    return unique;
  }

  private hasDefinitionPattern(content: string, entity: string): boolean {
    const patterns = [
      new RegExp(`${entity}\s+is\s+(?:a|an|the)`, 'i'),
      new RegExp(`${entity}\s+was\s+(?:a|an|the)`, 'i'),
      new RegExp(`${entity}\s*:\s*`, 'i'),
      new RegExp(`${entity}\s+refers to`, 'i'),
      new RegExp(`${entity}\s*\([^)]+\)`, 'i'), // Entity (description)
      new RegExp(`the\s+[\w\s]+,\s*${entity},`, 'i'), // Appositive
    ];

    return patterns.some(pattern => pattern.test(content));
  }

  private hasImplicitKnowledge(content: string, entity: string): boolean {
    // Check if entity is used in a way that assumes understanding
    const usagePatterns = [
      new RegExp(`(?:working on|using|with|for)\s+${entity}`, 'i'),
      new RegExp(`${entity}\s+(?:team|project|meeting|deadline)`, 'i'),
    ];

    return usagePatterns.some(pattern => pattern.test(content));
  }

  private generateGapSuggestion(entity: string, stats: any): string {
    if (stats.questionContexts > 0) {
      return `You've asked about "${entity}" ${stats.questionContexts} time(s), but I don't have a clear definition. Would you like to tell me more about what ${entity} is?`;
    }

    if (stats.mentions >= 5) {
      return `You've mentioned "${entity}" ${stats.mentions} times across different contexts, but I don't have a comprehensive understanding. Could you provide more details about ${entity}?`;
    }

    return `I've noticed you mention "${entity}" but lack context. What is ${entity}?`;
  }

  private async extractEventsFromMemories(memories: any[], entityName: string): Promise<Event[]> {
    const events: Event[] = [];

    for (const memory of memories) {
      // Simple event extraction - can be enhanced with NLP
      const sentences = memory.content.split(/[.!?]+/).filter((s: string) => s.trim().length > 0);
      
      for (const sentence of sentences) {
        if (sentence.toLowerCase().includes(entityName.toLowerCase())) {
          // Detect event type
          const type = this.detectEventType(sentence);
          
          events.push({
            date: memory.recordedAt || memory.createdAt,
            type,
            description: sentence.trim(),
            memoryId: memory.id,
            entities: (memory.metadata as any)?.detected_entities || [entityName],
            confidence: memory.confidenceScore || 0.7
          });
        }
      }
    }

    return events;
  }

  private detectEventType(sentence: string): string {
    const lower = sentence.toLowerCase();
    
    if (lower.match(/\b(met|meeting|discussed|talked|spoke)\b/)) return 'meeting';
    if (lower.match(/\b(decided|agreed|approved)\b/)) return 'decision';
    if (lower.match(/\b(hired|joined|started|began)\b/)) return 'start';
    if (lower.match(/\b(left|quit|ended|finished|completed)\b/)) return 'end';
    if (lower.match(/\b(changed|moved|updated|revised)\b/)) return 'change';
    if (lower.match(/\b(deadline|due|scheduled|planned)\b/)) return 'milestone';
    
    return 'general';
  }

  private resolveConflictingEvents(events: Event[]): Event[] {
    // Group events by similarity
    const groups: Event[][] = [];
    
    for (const event of events) {
      let foundGroup = false;
      
      for (const group of groups) {
        // Check if event is similar to group (same type, close date, similar content)
        const representative = group[0];
        const daysDiff = Math.abs(this.getDaysSince(event.date) - this.getDaysSince(representative.date));
        
        if (event.type === representative.type && daysDiff < 7) {
          group.push(event);
          foundGroup = true;
          break;
        }
      }
      
      if (!foundGroup) {
        groups.push([event]);
      }
    }

    // Keep highest confidence event from each group
    return groups.map(group => 
      group.sort((a, b) => b.confidence - a.confidence)[0]
    ).sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  private identifyCausalRelationships(events: Event[]): Event[] {
    // Add causal links between events
    // Simple heuristic: events of certain types likely cause others
    
    const causalPatterns: Record<string, string[]> = {
      'decision': ['start', 'change'],
      'start': ['milestone', 'meeting'],
      'meeting': ['decision', 'change'],
    };

    // This is a simplified version - full implementation would use more sophisticated analysis
    return events;
  }

  private identifyPhases(events: Event[]): Array<{ name: string; period: string; summary: string }> {
    if (events.length === 0) return [];

    const phases: Array<{ name: string; period: string; summary: string }> = [];
    const phaseSize = Math.max(1, Math.floor(events.length / 3));

    for (let i = 0; i < events.length; i += phaseSize) {
      const phaseEvents = events.slice(i, i + phaseSize);
      const startDate = phaseEvents[0].date;
      const endDate = phaseEvents[phaseEvents.length - 1].date;
      
      phases.push({
        name: this.generatePhaseName(phaseEvents),
        period: `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`,
        summary: `${phaseEvents.length} events including ${phaseEvents[0].type} and ${phaseEvents[phaseEvents.length - 1].type}`
      });
    }

    return phases;
  }

  private generatePhaseName(events: Event[]): string {
    const types = events.map(e => e.type);
    
    if (types.includes('start')) return 'Initiation';
    if (types.includes('decision')) return 'Planning';
    if (types.includes('milestone')) return 'Execution';
    if (types.includes('end')) return 'Completion';
    
    return 'Development';
  }

  private async generateStructuredNarrative(
    entityName: string,
    events: Event[],
    phases: Array<{ name: string; period: string; summary: string }>
  ): Promise<string> {
    const timelineText = events
      .map(e => `[${e.date.toLocaleDateString()}] ${e.type}: ${e.description}`)
      .join('\n');

    const phasesText = phases
      .map(p => `${p.name} (${p.period}): ${p.summary}`)
      .join('\n');

    const prompt = `Create a coherent narrative about "${entityName}" based on these chronological events.

TIMELINE:
${timelineText}

IDENTIFIED PHASES:
${phasesText}

Structure your narrative as follows:
1. Origins (1-2 sentences): How ${entityName} began
2. Key Developments (2-3 sentences): Major changes and milestones
3. Current State (1 sentence): Where things stand now

Use past tense for historical events, present tense for current state. Be concise but informative.

Narrative:`;

    try {
      const narrative = await llmService.generateCompletion(prompt);
      return narrative.trim();
    } catch (error) {
      return `${entityName} has ${events.length} recorded events spanning from ${events[0].date.toLocaleDateString()} to ${events[events.length - 1].date.toLocaleDateString()}.`;
    }
  }

  private async determineCurrentState(
    entityName: string,
    events: Event[],
    userId: string
  ): Promise<string> {
    if (events.length === 0) return 'Unknown';

    const recentEvents = events.slice(-3); // Last 3 events
    const lastEvent = recentEvents[recentEvents.length - 1];

    // Check if entity is still active based on recent events
    if (lastEvent.type === 'end' && this.getDaysSince(lastEvent.date) < 30) {
      return 'Inactive/Completed';
    }

    if (lastEvent.type === 'start' || lastEvent.type === 'milestone') {
      return 'Active';
    }

    // Default based on recency
    const daysSinceLastEvent = this.getDaysSince(lastEvent.date);
    if (daysSinceLastEvent < 30) return 'Active';
    if (daysSinceLastEvent < 90) return 'Dormant';
    return 'Historical';
  }

  private async classifyQueryIntent(query: string): Promise<{
    isConnectionQuery: boolean;
    type: string;
  }> {
    const lower = query.toLowerCase();

    if (lower.match(/who (can|could|should|might) help|who knows about|who understands/)) {
      return { isConnectionQuery: true, type: 'who_can_help' };
    }

    if (lower.match(/relationship between|how (is|are) .* related|connection between/)) {
      return { isConnectionQuery: true, type: 'relationship_between' };
    }

    if (lower.match(/who knows|who has experience|who worked/)) {
      return { isConnectionQuery: true, type: 'who_knows' };
    }

    if (lower.match(/how to reach|how can i contact|who should i talk to/)) {
      return { isConnectionQuery: true, type: 'how_to_reach' };
    }

    return { isConnectionQuery: false, type: 'unknown' };
  }

  private async findHelpPaths(
    userId: string,
    entities: any[],
    query: string
  ): Promise<Array<{ path: string[]; explanation: string; strength: number }>> {
    const paths: Array<{ path: string[]; explanation: string; strength: number }> = [];

    // Extract what help is needed from query
    const topic = this.extractTopicFromQuery(query);

    for (const entity of entities) {
      const relationships = await graphService.getRelationships(userId, entity.id, {
        onlyActive: true,
        limit: 20
      });

      for (const rel of relationships as EntityLinkWithEntities[]) {
        const relatedEntity = rel.entityId === entity.id ? rel.objectEntity : rel.subjectEntity;
        const relType = rel.role || 'related_to';

        // Check if this relationship indicates expertise or ability to help
        if (relType.match(/expert|specialist|lead|manager|knows_about/i) || 
            (topic && relatedEntity?.name.toLowerCase().includes(topic.toLowerCase()))) {
          
          const strength = await graphService.getRelationshipStrength(
            userId,
            entity.id,
            relatedEntity?.id || ''
          );

          paths.push({
            path: [entity.name, relType, relatedEntity?.name || ''],
            explanation: `${entity.name} ${relType} ${relatedEntity?.name}, who might be able to help`,
            strength
          });
        }

        // Look for second-degree connections
        if (relatedEntity?.id) {
          const secondDegree = await graphService.getRelationships(userId, relatedEntity.id, {
            onlyActive: true,
            limit: 5
          });

          for (const rel2 of secondDegree as EntityLinkWithEntities[]) {
            const finalEntity = rel2.entityId === relatedEntity.id ? rel2.objectEntity : rel2.subjectEntity;
            const rel2Type = rel2.role || 'related_to';

            if (rel2Type.match(/expert|specialist|lead/i)) {
              paths.push({
                path: [entity.name, relType, relatedEntity.name, rel2Type, finalEntity?.name || ''],
                explanation: `${entity.name} → ${relatedEntity.name} → ${finalEntity?.name} (${rel2Type})`,
                strength: (await graphService.getRelationshipStrength(userId, entity.id, relatedEntity?.id || '')) * 0.7 // Decay for longer paths
              });
            }
          }
        }
      }
    }

    return paths;
  }

  private async findRelationshipPaths(
    userId: string,
    entities: any[]
  ): Promise<Array<{ path: string[]; explanation: string; strength: number }>> {
    const paths: Array<{ path: string[]; explanation: string; strength: number }> = [];

    if (entities.length < 2) {
      return paths;
    }

    // Find paths between first two entities
    const graphPaths = await graphService.findAllPaths(
      userId,
      entities[0].id,
      entities[1].id,
      3, // maxDepth
      10 // maxPaths
    );

    return graphPaths.map(p => ({
      path: p.nodes.map(n => n.entityName),
      explanation: p.explanation,
      strength: p.strength
    }));
  }

  private async findKnowledgePaths(
    userId: string,
    entities: any[],
    query: string
  ): Promise<Array<{ path: string[]; explanation: string; strength: number }>> {
    return this.findHelpPaths(userId, entities, query);
  }

  private async findGeneralPaths(
    userId: string,
    entities: any[]
  ): Promise<Array<{ path: string[]; explanation: string; strength: number }>> {
    const paths: Array<{ path: string[]; explanation: string; strength: number }> = [];

    for (const entity of entities) {
      const relationships = await graphService.getRelationships(userId, entity.id, {
        onlyActive: true,
        limit: 10
      });

      for (const rel of relationships as EntityLinkWithEntities[]) {
        const relatedEntity = rel.entityId === entity.id ? rel.objectEntity : rel.subjectEntity;
        const relType = rel.role || 'related_to';

        const strength = await graphService.getRelationshipStrength(
          userId,
          entity.id,
          relatedEntity?.id || ''
        );

        paths.push({
          path: [entity.name, relType, relatedEntity?.name || ''],
          explanation: `${entity.name} ${relType} ${relatedEntity?.name}`,
          strength
        });
      }
    }

    return paths;
  }

  private rankPaths(
    paths: Array<{ path: string[]; explanation: string; strength: number }>, 
    query: string
  ): Array<{ path: string[]; explanation: string; strength: number }> {
    const queryLower = query.toLowerCase();

    return paths
      .map(p => {
        let score = p.strength;

        // Boost if path mentions query terms
        if (p.explanation.toLowerCase().split(/\s+/).some(word => queryLower.includes(word))) {
          score *= 1.5;
        }

        // Prefer shorter paths
        score *= Math.exp(-p.path.length / 5);

        return { ...p, score };
      })
      .sort((a, b) => (b as any).score - (a as any).score)
      .map(({ score, ...p }) => p);
  }

  private async generateGraphReasoning(
    query: string,
    paths: Array<{ path: string[]; explanation: string; strength: number }>, 
    queryIntent: any
  ): Promise<string> {
    if (paths.length === 0) {
      return "I couldn't find any relevant connections in your knowledge graph for this query.";
    }

    const pathsText = paths
      .slice(0, 5)
      .map(p => `- ${p.explanation}`)
      .join('\n');

    const prompt = `Based on these relationship paths, answer the user's query concisely.

QUERY: "${query}"
QUERY TYPE: ${queryIntent.type}

RELATIONSHIP PATHS:
${pathsText}

Provide a brief (2-3 sentences) answer that:
- Directly addresses the query
- Uses the relationship information
- Is specific and actionable

Answer:`;

    try {
      const reasoning = await llmService.generateCompletion(prompt);
      return reasoning.trim();
    } catch (error) {
      return `Found ${paths.length} relevant connections: ${paths[0].explanation}`;
    }
  }

  private extractTopicFromQuery(query: string): string | null {
    const match = query.match(/help (?:with|on|about) ([\w\s]+)/i);
    return match ? match[1].trim() : null;
  }

  private extractJSON(text: string): string {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return jsonMatch ? jsonMatch[0] : '{"implications": []}';
  }
}

export const reasoningService = new ReasoningService();