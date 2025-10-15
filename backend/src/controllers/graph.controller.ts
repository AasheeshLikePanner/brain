import { Request, Response } from 'express';
import { graphService } from '../services/graph.service';

class GraphController {
  // Hardcoded user for now. In a real app, this would come from auth middleware.
  private placeholderUserId = '123e4567-e89b-12d3-a456-426614174000';

  getEntities = async (req: Request, res: Response) => {
    const { type } = req.query;
    try {
      const entities = await graphService.getEntitiesByType(this.placeholderUserId, type as string);
      res.status(200).json(entities);
    } catch (error) {
      console.error('Error getting entities:', error);
      res.status(500).json({ error: 'Failed to retrieve entities' });
    }
  }

  getRelationships = async (req: Request, res: Response) => {
    const { entityName } = req.params;
    const { relationshipType } = req.query;

    if (!entityName) {
      return res.status(400).json({ error: 'Entity name is required' });
    }

    try {
      const relationships = await graphService.findRelatedEntities(this.placeholderUserId, entityName, relationshipType as string);
      res.status(200).json(relationships);
    } catch (error) {
      console.error('Error getting relationships:', error);
      res.status(500).json({ error: 'Failed to retrieve relationships' });
    }
  }
}

export const graphController = new GraphController();
