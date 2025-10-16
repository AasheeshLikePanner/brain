import prisma from '../db';
import { llmService } from './llm.service';
import { reasoningService } from './reasoning.service';
import { Prisma } from '@prisma/client';

interface ProactiveAlert {
  type: 'reminder' | 'connection' | 'pattern' | 'gap';
  priority: 'high' | 'medium' | 'low';
  content: string;
  relatedMemories: string[];
  actionable: boolean;
}

export class ProactiveService {

  /**
   * Generate proactive alerts for a user
   * This should be called periodically or when user starts a session
   */
  async generateProactiveAlerts(userId: string): Promise<ProactiveAlert[]> {
    const alerts: ProactiveAlert[] = [];

    // 1. Check for upcoming deadlines/reminders
    const reminderAlerts = await this.checkReminders(userId);
    alerts.push(...reminderAlerts);

    // 2. Check for connection opportunities
    const connectionAlerts = await this.checkConnectionOpportunities(userId);
    alerts.push(...connectionAlerts);

    // 3. Check for patterns
    const patternAlerts = await this.checkPatterns(userId);
    alerts.push(...patternAlerts);

    // 4. Check for knowledge gaps
    const gapAlerts = await this.checkKnowledgeGaps(userId);
    alerts.push(...gapAlerts);

    // Sort by priority
    return alerts.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  /**
   * Check for upcoming deadlines and reminders
   */
  private async checkReminders(userId: string): Promise<ProactiveAlert[]> {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const nextWeek = new Date(now);
    nextWeek.setDate(nextWeek.getDate() + 7);

    // Find memories with temporal data in the near future
    const upcomingMemories = await prisma.memory.findMany({
      where: {
        userId,
        deleted: false,
        recordedAt: {
          not: null, // Check if recordedAt is not null
          gte: now,
          lte: nextWeek
        }
      },
      select: {
        id: true,
        content: true,
        metadata: true,
        recordedAt: true
      }
    });

    console.log(`[ProactiveService] checkReminders: Found ${upcomingMemories.length} upcoming memories.`);
    upcomingMemories.forEach(mem => console.log(`  - Memory ID: ${mem.id}, RecordedAt: ${mem.recordedAt?.toISOString()}`));

    const alerts: ProactiveAlert[] = [];

    for (const memory of upcomingMemories) {
      const eventDate = memory.recordedAt; // Use recordedAt directly
      if (!eventDate) continue; // Should not happen due to where clause

      const daysUntil = Math.ceil((eventDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      
      let priority: 'high' | 'medium' | 'low' = 'low';
      if (daysUntil <= 1) priority = 'high';
      else if (daysUntil <= 3) priority = 'medium';

      // Check if memory indicates an action item
      const actionKeywords = ['need to', 'must', 'should', 'remember to', "don't forget"];
      const isActionable = actionKeywords.some(keyword => 
        memory.content.toLowerCase().includes(keyword)
      );

      alerts.push({
        type: 'reminder',
        priority,
        content: `Upcoming (${daysUntil} day${daysUntil !== 1 ? 's' : ''}): ${memory.content}`,
        relatedMemories: [memory.id],
        actionable: isActionable
      });
    }

    return alerts;
  }

  /**
   * Check for connection opportunities
   * Example: User mentions someone, check if there are unresolved items with them
   */
  private async checkConnectionOpportunities(userId: string): Promise<ProactiveAlert[]> {
    const alerts: ProactiveAlert[] = [];

    // Get recent chat messages (last 24 hours)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const recentChats = await prisma.chatMessage.findMany({
      where: {
        chat: { userId },
        role: 'user',
        createdAt: { gte: yesterday }
      },
      select: {
        content: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    // Extract mentioned people from recent chats
    const entities = await prisma.entity.findMany({
      where: {
        userId,
        type: { in: ['person', 'unknown'] }
      },
      select: { id: true, name: true }
    });

    const mentionedPeople = entities.filter(e =>
      recentChats.some(chat => 
        chat.content.toLowerCase().includes(e.name.toLowerCase())
      )
    );

    // For each mentioned person, check for old unresolved items
    for (const person of mentionedPeople) {
      const threeWeeksAgo = new Date();
      threeWeeksAgo.setDate(threeWeeksAgo.getDate() - 21);

      const oldMemoriesAboutPerson = await prisma.memory.findMany({
        where: {
          userId,
          deleted: false,
          content: {
            contains: person.name,
            mode: 'insensitive'
          },
          createdAt: {
            lte: threeWeeksAgo
          }
        },
        select: {
          id: true,
          content: true,
          createdAt: true
        },
        take: 5
      });

      // Check if any suggest pending action
      const pendingActions = oldMemoriesAboutPerson.filter(m => {
        const actionPhrases = [
          'need to ask',
          'should discuss',
          'want to talk',
          'follow up',
          'check with'
        ];
        return actionPhrases.some(phrase => 
          m.content.toLowerCase().includes(phrase)
        );
      });

      if (pendingActions.length > 0) {
        const oldest = pendingActions.sort((a, b) => 
          a.createdAt.getTime() - b.createdAt.getTime()
        )[0];

        const weeksAgo = Math.floor(
          (Date.now() - oldest.createdAt.getTime()) / (1000 * 60 * 60 * 24 * 7)
        );

        alerts.push({
          type: 'connection',
          priority: 'medium',
          content: `You just mentioned ${person.name}. ${weeksAgo} week${weeksAgo !== 1 ? 's' : ''} ago, you noted: "${oldest.content.substring(0, 100)}..." - did this get resolved?`,
          relatedMemories: [oldest.id],
          actionable: true
        });
      }
    }

    return alerts;
  }

  /**
   * Check for patterns in user behavior or mentions
   */
  private async checkPatterns(userId: string): Promise<ProactiveAlert[]> {
    const alerts: ProactiveAlert[] = [];
    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - 7);

    // Get recent memories
    const recentMemories = await prisma.memory.findMany({
      where: {
        userId,
        deleted: false,
        createdAt: { gte: lastWeek }
      },
      select: {
        id: true,
        content: true,
        type: true,
        createdAt: true
      }
    });

    // Look for repeated mentions of states/feelings
    const stateKeywords = {
      tired: ['tired', 'exhausted', 'fatigue', 'sleepy'],
      stressed: ['stressed', 'overwhelmed', 'anxious', 'pressure'],
      productive: ['productive', 'accomplished', 'finished', 'completed'],
      unproductive: ['unproductive', 'distracted', 'procrastinating']
    };

    for (const [state, keywords] of Object.entries(stateKeywords)) {
      const matchingMemories = recentMemories.filter(m =>
        keywords.some(kw => m.content.toLowerCase().includes(kw))
      );

      if (matchingMemories.length >= 3) {
        // Look for previously noted solutions
        const twoMonthsAgo = new Date();
        twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);

        const pastSolutions = await prisma.memory.findMany({
          where: {
            userId,
            deleted: false,
            createdAt: {
              gte: twoMonthsAgo,
              lt: lastWeek
            },
            OR: [
              { content: { contains: 'helped', mode: 'insensitive' } },
              { content: { contains: 'worked', mode: 'insensitive' } },
              { content: { contains: 'better', mode: 'insensitive' } }
            ]
          },
          select: {
            id: true,
            content: true
          },
          take: 5
        });

        // Check if solutions relate to the current state
        const relevantSolution = pastSolutions.find(sol =>
          keywords.some(kw => sol.content.toLowerCase().includes(kw))
        );

        if (relevantSolution) {
          alerts.push({
            type: 'pattern',
            priority: 'medium',
            content: `Pattern alert: You've mentioned feeling ${state} ${matchingMemories.length} times this week. Previously, you found this helpful: "${relevantSolution.content.substring(0, 100)}..."`,
            relatedMemories: [relevantSolution.id, ...matchingMemories.map(m => m.id)],
            actionable: true
          });
        } else {
          alerts.push({
            type: 'pattern',
            priority: 'low',
            content: `I've noticed you've mentioned feeling ${state} ${matchingMemories.length} times this week. Would you like to discuss strategies that might help?`,
            relatedMemories: matchingMemories.map(m => m.id),
            actionable: false
          });
        }
      }
    }

    return alerts;
  }

  /**
   * Check for knowledge gaps
   */
  private async checkKnowledgeGaps(userId: string): Promise<ProactiveAlert[]> {
    const gaps = await reasoningService.identifyKnowledgeGaps(userId);
    
    return gaps.slice(0, 2).map(gap => ({
      type: 'gap' as const,
      priority: 'low' as const,
      content: gap.suggestion,
      relatedMemories: [],
      actionable: true
    }));
  }

  /**
   * Format proactive alerts for display
   */
  formatAlertsForDisplay(alerts: ProactiveAlert[]): string {
    if (alerts.length === 0) return '';

    let formatted = '**Proactive Insights:**\n\n';

    const highPriority = alerts.filter(a => a.priority === 'high');
    const mediumPriority = alerts.filter(a => a.priority === 'medium');
    const lowPriority = alerts.filter(a => a.priority === 'low');

    if (highPriority.length > 0) {
      formatted += '🔴 **Urgent:**\n';
      highPriority.forEach(alert => {
        formatted += `- ${alert.content}\n`;
      });
      formatted += '\n';
    }

    if (mediumPriority.length > 0 && mediumPriority.length <= 3) {
      formatted += '🟡 **Worth noting:**\n';
      mediumPriority.forEach(alert => {
        formatted += `- ${alert.content}\n`;
      });
      formatted += '\n';
    }

    if (lowPriority.length > 0 && lowPriority.length <= 2) {
      formatted += '🔵 **FYI:**\n';
      lowPriority.forEach(alert => {
        formatted += `- ${alert.content}\n`;
      });
    }

    return formatted;
  }
}
