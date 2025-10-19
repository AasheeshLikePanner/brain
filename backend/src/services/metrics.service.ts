import redis from '../queues/redis';

class MetricsService {
  
  async trackQuery(
    userId: string,
    query: string,
    metrics: {
      isComplex: boolean;
      cacheHit: boolean;
      responseTime: number;
      memoriesRetrieved: number;
    }
  ): Promise<void> {
    console.time('metricsService.trackQuery');
    try {
      const timestamp = Date.now();
      const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      
      // Store in Redis for quick access
      const metricsKey = `metrics:${date}`;
      
      await redis.hincrby(metricsKey, 'total_queries', 1);
      
      if (metrics.isComplex) {
        await redis.hincrby(metricsKey, 'complex_queries', 1);
      } else {
        await redis.hincrby(metricsKey, 'simple_queries', 1);
      }
      
      if (metrics.cacheHit) {
        await redis.hincrby(metricsKey, 'cache_hits', 1);
      } else {
        await redis.hincrby(metricsKey, 'cache_misses', 1);
      }
      
      // Track average response time
      const currentAvg = await redis.hget(metricsKey, 'avg_response_time');
      const currentCount = await redis.hget(metricsKey, 'total_queries');
      
      if (currentAvg && currentCount) {
        const newAvg = (parseFloat(currentAvg) * (parseInt(currentCount) - 1) + metrics.responseTime) / parseInt(currentCount);
        await redis.hset(metricsKey, 'avg_response_time', newAvg.toString());
      } else {
        await redis.hset(metricsKey, 'avg_response_time', metrics.responseTime.toString());
      }
      
      // Expire after 30 days
      await redis.expire(metricsKey, 30 * 24 * 60 * 60);
      console.timeEnd('metricsService.trackQuery');
    } catch (error) {
      console.error('[Metrics] Error tracking query:', error);
      console.timeEnd('metricsService.trackQuery');
    }
  }
  
  async getMetrics(date: string = new Date().toISOString().split('T')[0]): Promise<any> {
    try {
      const metricsKey = `metrics:${date}`;
      const data = await redis.hgetall(metricsKey);
      
      if (!data || Object.keys(data).length === 0) {
        return null;
      }
      
      const totalQueries = parseInt(data.total_queries || '0');
      const cacheHits = parseInt(data.cache_hits || '0');
      const cacheMisses = parseInt(data.cache_misses || '0');
      
      return {
        date,
        totalQueries,
        complexQueries: parseInt(data.complex_queries || '0'),
        simpleQueries: parseInt(data.simple_queries || '0'),
        cacheHits,
        cacheMisses,
        cacheHitRate: totalQueries > 0 ? ((cacheHits / totalQueries) * 100).toFixed(2) + '%' : '0%',
        avgResponseTime: parseFloat(data.avg_response_time || '0').toFixed(2) + 'ms'
      };
    } catch (error) {
      console.error('[Metrics] Error getting metrics:', error);
      return null;
    }
  }
}

export const metricsService = new MetricsService();