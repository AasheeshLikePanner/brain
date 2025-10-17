import { Router } from 'express';
import { graphController } from '../../controllers/graph.controller';
import { isAuthenticated } from '../../middleware/auth.middleware'; // New: Import authentication middleware

const router = Router();

// Route to get all entities for a user
// GET /api/graph/entities
router.get('/entities', isAuthenticated, graphController.getEntities);

// Route to get relationships for a specific entity
// GET /api/graph/relationships/:entityName
router.get('/relationships/:entityName', isAuthenticated, graphController.getRelationships);

export default router;
