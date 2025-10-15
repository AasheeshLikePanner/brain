'use client';

import { useState, useEffect } from 'react';

import { getGraphEntities, getGraphRelationships }

  from '../../lib/api'; // Adjust path as needed

import { GraphVisualization } from '../../components/GraphVisualization';

interface Entity {
  id: string;
  name: string;
  type?: string;
}

interface Relationship {
  subject: string;
  predicate: string;
  object?: string;
  source?: string;
}

export default function GraphExplorerPage() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [selectedEntity, setSelectedEntity] = useState<
    Entity | null>(null);
  const [relationships, setRelationships] = useState<
    Relationship[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchEntities = async () => {
      setLoading(true);
      setError(null);
      try {
        const fetchedEntities = await getGraphEntities();
        setEntities(fetchedEntities);
      } catch (err) {
        setError('Failed to load entities.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchEntities();
  }, []);

  const handleEntitySelect = async (entity: Entity) => {
    setSelectedEntity(entity);
    setLoading(true);
    setError(null);
    try {
      // Fetch relationships where this entity is the 
      // subject
      const fetchedRelationships = await
        getGraphRelationships(entity.name);
      setRelationships(fetchedRelationships);
    } catch (err) {
      setError(`Failed to load relationships for 
      ${entity.name}.`);
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen bg-gray-900 text-gray-200">
      <div className="w-[300px] border-r border-gray-700 p-4 overflow-y-auto">
        <h2>Entities</h2>
        {loading && <p>Loading entities...</p>}
        {error && <p className="text-red-500">{error}</p>}
        <ul>
          {entities.map((entity) => (
            <li
              key={entity.id}
              onClick={() => handleEntitySelect(entity)}
              className={`cursor-pointer py-1 border-b border-dotted border-gray-700 ${selectedEntity?.id === entity.id ? 'bg-gray-700' : 'bg-transparent'}`}
            >
              {entity.name} ({entity.type || 'unknown'})
            </li>
          ))}
        </ul>
      </div>

      <div className="flex-grow p-4 overflow-y-auto">
        {selectedEntity ? (
          <GraphVisualization selectedEntity={selectedEntity} relationships={relationships} />
        ) : (
          <p>Select an entity from the left to view its relationships.</p>
        )}
      </div>
    </div>
  );
}