import prisma from '../db';
import { llmService } from './llm.service';
import { graphService } from './graph.service';

interface Implication {
  type: 'action_suggestion' | 'connection' | 'gap';
  content: string;
  relatedMemories: string[];
  confidence: number;
}

export class ReasoningService {

  /**
   * Detect implications from a set of memories
   * Example: If "John wants AI updates" and "Sarah is AI lead" → suggest coordination
   */
  async detectImplications(
    userId: string,
    contextMemories: any[],
    currentQuery: string
  ): Promise<Implication[]> {
    if (contextMemories.length < 2) {
      return []; // Need multiple memories to find implications
    }

    // Format memories for LLM
    const memoriesText = contextMemories
      .map((m, i) => `[${i}] ${m.content}`)
      .join('\n');

    const prompt = `Given the following memories about a user and their current query, identify logical implications, connections, or action suggestions.

USER'S MEMORIES:
${memoriesText}

CURRENT QUERY: "${currentQuery}"

Task: Analyze these memories and identify:
1. ACTION SUGGESTIONS: If the memories imply an action the user might need to take
2. CONNECTIONS: If memories are related in ways that provide useful insight
3. GAPS: If memories reference something important but lack crucial details

Examples:
- If one memory says "John wants weekly AI updates" and another says "Sarah is lead AI engineer", suggest: "You might want to coordinate with Sarah for John's AI update"
- If multiple memories mention "Project Titan" but none explain what it is, identify this gap
- If user asks about deadlines and memories show related commitments, connect them

Respond in JSON format:
{
  "implications": [
    {
      "type": "action_suggestion" | "connection" | "gap",
      "content": "<the implication or suggestion>",
      "relatedMemoryIndices": [<indices of relevant memories>],
      "confidence": <0.0-1.0>,
      "reasoning": "<brief explanation of why this implication exists>"
    }
  ]
}

Only include high-confidence (>0.6) implications that are genuinely useful.`;

    try {
      const response = await llmService.generateCompletion(prompt);
      const parsed = JSON.parse(this.extractJSON(response));

      const implications: Implication[] = parsed.implications
        .filter((imp: any) => imp.confidence > 0.6)
        .map((imp: any) => ({
          type: imp.type,
          content: imp.content,
          relatedMemories: imp.relatedMemoryIndices.map((idx: number) => contextMemories[idx].id),
          confidence: imp.confidence
        }));

      return implications;
    } catch (error) {
      console.error('Error detecting implications:', error);
      return [];
    }
  }

  /**
   * Identify knowledge gaps - things mentioned repeatedly but never explained
   */
  async identifyKnowledgeGaps(userId: string): Promise<Array<{ 
    entity: string;
    mentionCount: number;
    hasDefinition: boolean;
    suggestion: string;
  }>> {
    // Get all entities mentioned in memories
    const memories = await prisma.memory.findMany({
      where: {
        userId,
        deleted: false,
        confidenceScore: { gt: 0.3 }
      },
      select: {
        id: true,
        content: true,
        metadata: true
      }
    });

    // Count entity mentions
    const entityMentions = new Map<string, number>();
    const entityDefinitions = new Set<string>();

    for (const memory of memories) {
      const entities = (memory.metadata as any)?.detected_entities || [];
      
      for (const entity of entities) {
        entityMentions.set(entity, (entityMentions.get(entity) || 0) + 1);
        
        // Check if this memory defines the entity
        const defPatterns = [
          `${entity} is`,
          `${entity} was`,
          `${entity}:`,
          `what is ${entity}`,
          `${entity} refers to`
        ];
        
        if (defPatterns.some(pattern => 
          memory.content.toLowerCase().includes(pattern.toLowerCase())
        )) {
          entityDefinitions.add(entity);
        }
      }
    }

    // Find entities mentioned multiple times but never defined
    const gaps: Array<{ 
      entity: string;
      mentionCount: number;
      hasDefinition: boolean;
      suggestion: string;
    }> = [];

    for (const [entity, count] of entityMentions.entries()) {
      if (count >= 3 && !entityDefinitions.has(entity)) {
        gaps.push({
          entity,
          mentionCount: count,
          hasDefinition: false,
          suggestion: `You've mentioned "${entity}" ${count} times but I don't have details about what it is. Would you like to tell me more?`
        });
      }
    }

    return gaps.sort((a, b) => b.mentionCount - a.mentionCount).slice(0, 5);
  }

  /**
   * Build a timeline for an entity or topic
   */
  async buildTimeline(
    userId: string,
    entityName: string
  ): Promise<{ 
    entity: string;
    timeline: Array<{ 
      date: Date;
      event: string;
      memoryId: string;
      type: string;
    }>;
    narrative: string;
  }> {
    console.time(`reasoningService.buildTimeline(${entityName})`);
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
      orderBy: { 
        recordedAt: 'asc'
      },
      select: {
        id: true,
        content: true,
        recordedAt: true,
        createdAt: true,
        type: true
      }
    });

    if (memories.length === 0) {
      console.timeEnd(`reasoningService.buildTimeline(${entityName})`);
      return {
        entity: entityName,
        timeline: [],
        narrative: `No memories found about ${entityName}.`
      };
    }

    // Build timeline events
    const timeline = memories.map(m => ({
      date: m.recordedAt || m.createdAt,
      event: m.content,
      memoryId: m.id,
      type: m.type || 'unknown'
    }));

    // Generate narrative using LLM
    const timelineText = timeline
      .map(t => `[${t.date.toLocaleDateString()}] ${t.event}`)
      .join('\n');

    const prompt = `Given the following chronological events about "${entityName}", create a coherent narrative summary that tells the story of this entity over time.\n\nTIMELINE:\n${timelineText}\n\nCreate a narrative that:\n- Identifies key developments and changes over time\n- Notes relationships and connections that formed\n- Highlights the current state\n- Uses past tense for historical events, present tense for current state\n\nKeep it concise (3-5 sentences) but informative.\n\nNarrative:`;

    try {
      console.time(`llmService.generateCompletion (buildTimeline for ${entityName})`);
      const narrative = await llmService.generateCompletion(prompt);
      console.timeEnd(`llmService.generateCompletion (buildTimeline for ${entityName})`);
      
      console.timeEnd(`reasoningService.buildTimeline(${entityName})`);
      return {
        entity: entityName,
        timeline,
        narrative: narrative.trim()
      };
    } catch (error) {
      console.error('Error building timeline narrative:', error);
      console.timeEnd(`reasoningService.buildTimeline(${entityName})`);
      return {
        entity: entityName,
        timeline,
        narrative: `Timeline of ${timeline.length} events related to ${entityName}.`
      };
    }
  }

  /**
   * Perform graph-based reasoning
   * Example: "Who can help me with X?" → traverse graph to find connected experts
   */
  async graphReasoning(
    userId: string,
    query: string
  ): Promise<{ 
    reasoning: string;
    relevantPaths: Array<{ 
      path: string[];
      explanation: string;
    }>;
  }> {
    // Detect if query is asking for connections
    const connectionPatterns = [
      /who (can|could|should|might) help/i,
      /who knows about/i,
      /who is connected to/i,
      /relationship between/i,
      /how is .* related to/i
    ];

    const isConnectionQuery = connectionPatterns.some(pattern => pattern.test(query));

    if (!isConnectionQuery) {
      return { reasoning: '', relevantPaths: [] };
    }

    // Extract entities from query
    const entities = await prisma.entity.findMany({
      where: { userId },
      select: { id: true, name: true, type: true }
    });

    const mentionedEntities = entities.filter(e =>
      query.toLowerCase().includes(e.name.toLowerCase())
    );

    if (mentionedEntities.length === 0) {
      return { reasoning: '', relevantPaths: [] };
    }

    // For each mentioned entity, get their relationships
    const paths: Array<{ path: string[]; explanation: string }> = [];

    for (const entity of mentionedEntities) {
      const relationships = await graphService.getRelationships(userId, entity.id);

      for (const rel of relationships) {
        const subject = rel.subjectEntity.name;
        const object = rel.objectEntity?.name || '';
        const predicate = rel.role || '';
        const path = [subject, predicate, object];
        const explanation = `${subject} ${predicate} ${object}`;
        paths.push({ path, explanation });

        // Look for second-degree connections
        const connectedEntity = entities.find(e => 
          e.name === object || e.name === subject
        );

        if (connectedEntity && connectedEntity.id !== entity.id) {
          const secondDegree = await graphService.getRelationships(
            userId, 
            connectedEntity.id
          );

          for (const rel2 of secondDegree.slice(0, 3)) {
            const extendedPath = [...path, rel2.role || '', rel2.objectEntity?.name || ''];
            paths.push({
              path: extendedPath,
              explanation: `${explanation}, and ${rel2.subjectEntity.name} ${rel2.role} ${rel2.objectEntity?.name || ''}`
            });
          }
        }
      }
    }

    // Generate reasoning about these paths
    const pathsText = paths
      .slice(0, 10)
      .map(p => p.explanation)
      .join('\n');

    const prompt = `Based on these relationship paths from the user's knowledge graph, provide insight for their query.\n\nQUERY: "${query}"\n\nRELATIONSHIP PATHS:\n${pathsText}\n\nProvide a brief (2-3 sentences) answer that uses these relationships to address the query.\n\nAnswer:`;

    try {
      const reasoning = await llmService.generateCompletion(prompt);
      
      return {
        reasoning: reasoning.trim(),
        relevantPaths: paths.slice(0, 5)
      };
    } catch (error) {
      console.error('Error in graph reasoning:', error);
      return { reasoning: '', relevantPaths: paths.slice(0, 5) };
    }
  }

  private extractJSON(text: string): string {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return jsonMatch ? jsonMatch[0] : '{"implications": []}';
  }
}

export const reasoningService = new ReasoningService();
