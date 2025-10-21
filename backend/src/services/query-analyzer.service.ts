export interface QueryAnalysis {
  isComplex: boolean;
  isFactual: boolean;
  type: 'simple' | 'timeline' | 'relationship' | 'analysis' | 'math' | 'code' | 'comparative';
  entities: string[];
  needsGraph: boolean;
  needsTimeline: boolean;
  confidence: number; // 0–1
}

class QueryAnalyzerService {
  analyzeQuery(query: string): QueryAnalysis {
    console.time('queryAnalyzerService.analyzeQuery');
    const q = query.trim();
    const lower = q.toLowerCase();
    const entities = this.extractEntities(q);

    // === Pattern groups ===
    const timelinePatterns = [
      /timeline of/i, /history of/i, /evolution of/i,
      /what happened (with|to|in)/i, /chronology/i, /events (related|about|of)/i
    ];
    const relationshipPatterns = [
      /relationship between/i, /how is .* (related|connected) to/i,
      /who (knows|works with|collaborates|is involved)/i, /network of/i, /connections?/i
    ];
    const analysisPatterns = [
      /should i/i, /analyze/i, /implications?/i, /impact of/i,
      /compare/i, /difference between/i, /pros and cons/i,
      /correlation/i, /what if/i
    ];
    const mathPatterns = [
      /\d+\s*[\+\-\*\/]\s*\d+/, /calculate/i, /sum/i, /multiply/i, /average/i, /percent/i
    ];
    const codePatterns = [
      /code snippet/i, /function to/i, /in python/i, /in javascript/i, /write a program/i,
      /regex/i, /algorithm/i, /time complexity/i
    ];
    const factualPatterns = [
      /what is/i, /who is/i, /when (was|is)/i, /where is/i,
      /how many/i, /define/i, /explain/i, /tell me about/i, /facts? about/i
    ];
    const comparativePatterns = [
      /compare/i, /difference between/i, /vs\./i, /better than/i, /which is (better|faster|more)/i
    ];

    // === Pattern checks ===
    const match = (patterns: RegExp[]) => patterns.some(p => p.test(q));
    const needsTimeline = match(timelinePatterns);
    const needsGraph = match(relationshipPatterns);
    const isAnalysis = match(analysisPatterns);
    const isMath = match(mathPatterns);
    const isCode = match(codePatterns);
    const isComparative = match(comparativePatterns);
    const isFactual = match(factualPatterns) && !isAnalysis && !isMath && !isCode;

    // === Determine type ===
    let type: QueryAnalysis['type'] = 'simple';
    if (needsTimeline) type = 'timeline';
    else if (needsGraph) type = 'relationship';
    else if (isAnalysis) type = 'analysis';
    else if (isMath) type = 'math';
    else if (isCode) type = 'code';
    else if (isComparative) type = 'comparative';

    // === Compute complexity and confidence ===
    const complexityScore =
      (needsTimeline ? 0.3 : 0) +
      (needsGraph ? 0.3 : 0) +
      (isAnalysis ? 0.3 : 0) +
      (isMath || isCode ? 0.4 : 0) +
      (isComparative ? 0.2 : 0);

    const isComplex = complexityScore > 0.3;
    const confidence = Math.min(1, complexityScore + (isFactual ? 0.2 : 0.1));

    const result: QueryAnalysis = {
      isComplex,
      isFactual,
      type,
      entities,
      needsGraph,
      needsTimeline,
      confidence: parseFloat(confidence.toFixed(2)),
    };

    console.timeEnd('queryAnalyzerService.analyzeQuery');
    return result;
  }

  /**
   * Extract entities (handles capitalized, lowercase, hashtags, and quoted text)
   */
  private extractEntities(query: string): string[] {
    const entities: string[] = [];

    // Quoted strings
    const quoted = query.match(/"([^"]+)"|'([^']+)'/g) || [];
    entities.push(...quoted.map(q => q.replace(/['"]+/g, '')));

    // Hashtags
    const hashtags = query.match(/#\w+/g) || [];
    entities.push(...hashtags.map(h => h.slice(1)));

    // Capitalized or title-cased phrases
    const caps = query.match(/\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)*\b/g) || [];
    entities.push(...caps);

    // Common noun phrases (two+ lowercase words)
    const nounPhrases = query.match(/\b[a-z]+(?:\s[a-z]+){1,2}\b/g) || [];
    const topicKeywords = nounPhrases?.filter(p =>
      /(ai|machine learning|neural network|space|economy|health|music|history|climate)/i.test(p)
    ) || [];
    entities.push(...topicKeywords);

    // Deduplicate and filter stop words
    const stopWords = new Set([
      'I', 'The', 'A', 'An', 'This', 'That', 'My', 'Your', 'What', 'We',
      'They', 'He', 'She', 'It', 'Could', 'Should', 'Would', 'Can', 'May',
      'Will', 'Do', 'Does', 'Did', 'Of', 'In', 'To', 'On', 'At', 'For'
    ]);
    const unique = [...new Set(entities.map(e => e.trim()))].filter(e => e && !stopWords.has(e));

    return unique;
  }
}

export const queryAnalyzerService = new QueryAnalyzerService();
