import { Request, Response } from 'express';
import { metricsService } from '../services/metrics.service';

export class MetricsController {
  
  async getMetrics(req: Request, res: Response): Promise<void> {
    try {
      const date = req.query.date as string || new Date().toISOString().split('T')[0];
      
      const metrics = await metricsService.getMetrics(date);
      
      if (!metrics) {
        res.status(404).json({ error: 'No metrics found for this date' });
        return;
      }
      
      res.json(metrics);
      
    } catch (error) {
      console.error('[MetricsController] Error:', error);
      res.status(500).json({ error: 'Failed to get metrics' });
    }
  }
}

export const metricsController = new MetricsController();