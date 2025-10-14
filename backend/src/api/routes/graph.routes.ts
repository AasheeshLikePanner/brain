import { Router } from 'express';
import { graphController } from '../../controllers/graph.controller';

const router = Router();

// Route to get all entities for a user
// GET /api/graph/entities
router.get('/entities', graphController.getEntities);

// Route to get relationships for a specific entity
// GET /api/graph/relationships/:entityName
router.get('/relationships/:entityName', graphController.getRelationships);

export default router;
