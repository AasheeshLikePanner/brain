export interface QueryAnalysis {
  isComplex: boolean;
  type: 'simple' | 'timeline' | 'relationship' | 'analysis';
  entities: string[];
  needsGraph: boolean;
  needsTimeline: boolean;
}

class QueryAnalyzerService {
  
  /**
   * Fast pattern matching to determine query complexity
   * Takes < 1ms
   */
  analyzeQuery(query: string): QueryAnalysis {
    const lowerQuery = query.toLowerCase();
    const entities = this.extractEntities(query);
    
    // Timeline patterns
    const timelinePatterns = [
      /timeline of/i,
      /history of/i,
      /what happened (with|to|in)/i,
      /events (of|about|related to)/i,
      /chronology/i,
    ];
    
    // Relationship patterns
    const relationshipPatterns = [
      /who (can|could|should|might) help/i,
      /who (knows|works on|is involved)/i,
      /relationship between/i,
      /how is .* (related|connected) to/i,
      /connect me with/i,
      /who.*with/i,
    ];
    
    // Analysis patterns
    const analysisPatterns = [
      /should i/i,
      /what do you (think|suggest|recommend)/i,
      /analyze/i,
      /implications of/i,
      /what if/i,
    ];
    
    // Check patterns
    const needsTimeline = timelinePatterns.some(p => p.test(query));
    const needsGraph = relationshipPatterns.some(p => p.test(query));
    const needsAnalysis = analysisPatterns.some(p => p.test(query));
    
    // Determine complexity
    const isComplex = needsTimeline || needsGraph || needsAnalysis;
    
    let type: 'simple' | 'timeline' | 'relationship' | 'analysis' = 'simple';
    if (needsTimeline) type = 'timeline';
    else if (needsGraph) type = 'relationship';
    else if (needsAnalysis) type = 'analysis';
    
    return {
      isComplex,
      type,
      entities,
      needsGraph,
      needsTimeline,
    };
  }
  
  /**
   * Extract entities from query (capitalized words/phrases)
   */
  private extractEntities(query: string): string[] {
    // Match capitalized words/phrases
    const matches = query.match(/\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)*\b/g) || [];
    
    // Filter out common stop words
    const stopWords = new Set([
      'I', 'The', 'A', 'An', 'This', 'That', 'My', 'Your', 'What',
      'We', 'They', 'He', 'She', 'It', 'Could', 'Should', 'Would',
      'Can', 'May', 'Will', 'Do', 'Does', 'Did'
    ]);
    
    const entities = matches.filter(w => !stopWords.has(w));
    
    // Return unique entities
    return [...new Set(entities)];
  }
}

export const queryAnalyzerService = new QueryAnalyzerService();