'use client';
import React, { useRef, useEffect, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';

interface Node {
  id: string;
  name: string;
  group: number; // For coloring
}

interface Link {
  source: string;
  target: string;
  label: string;
}

interface GraphData {
  nodes: Node[];
  links: Link[];
}

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

interface GraphVisualizationProps {
  selectedEntity: Entity | null;
  relationships: Relationship[];
}

export const GraphVisualization = ({ selectedEntity,
  relationships }: GraphVisualizationProps) => {
  const fgRef = useRef();
  const [graphData, setGraphData] = useState<GraphData>({
    nodes: [], links: []
  });

  useEffect(() => {
    if (selectedEntity && relationships.length > 0) {
      const nodes: Node[] = [{
        id: selectedEntity.id,
        name: selectedEntity.name,
        group: 1
      }];
      const links: Link[] = [];

      relationships.forEach(rel => {
        const objectId = rel.object || `memory-${Math
          .random()}`; // Placeholder for non-entity objects
        if (!nodes.some(n => n.id === objectId)) {
          nodes.push({
            id: objectId,
            name: rel.object ||
              rel.source?.substring(0, 20) || 'Memory',
            group: 2
          });
        }
        links.push({
          source: selectedEntity.id,
          target: objectId,
          label: rel.predicate
        });
      });

      setGraphData({ nodes, links });
    } else {
      setGraphData({ nodes: [], links: [] });
    }
  }, [selectedEntity, relationships]);

  return (
    <ForceGraph2D
      graphData={graphData}
      nodeLabel="name"
      linkDirectionalArrowLength={3.5}
      linkDirectionalArrowRelPos={1}
      linkCanvasObject={(link, ctx, globalScale) => {
        const start = link.source;
        const end = link.target;
        if (typeof start === 'object' && typeof end ===
          'object') {
          const label = link.label;
          const textPos = Object.assign({}, start);
          const r = Math.hypot(end.x - start.x, end.y -
            start.y);
          const angle = Math.atan2(end.y - start.y, end.x -
            start.x);
          const textWidth = ctx.measureText(label).width;
          const textHeight = 10; // Approx font height

          ctx.save();
          ctx.translate(textPos.x, textPos.y);
          ctx.rotate(angle);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = 'white';
          ctx.fillText(label, r / 2, 0);
          ctx.restore();
        }
      }}
      nodeCanvasObject={(node, ctx, globalScale) => {
        const label = node.name;
        const fontSize = 12 / globalScale;
        ctx.font = `${fontSize}px Sans-Serif`;
        const textWidth = ctx.measureText(label).width;
        const bckgDimensions = [textWidth, fontSize].map(n => n + fontSize * 0.2); // some padding

        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.fillRect(node.x - bckgDimensions[0] / 2, node.y
          - bckgDimensions[1] / 2, bckgDimensions[0],
          bckgDimensions[1]);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = node.group === 1 ? '#82aaff' :
          '#ffc762'; // Highlight selected entity
        ctx.fillText(label, node.x, node.y);
      }}
    />
  );
};