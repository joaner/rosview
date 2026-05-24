import React, { useCallback, useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';

export interface GraphMutation {
  fit: () => void;
}

interface GraphProps {
  elements: cytoscape.ElementDefinition[];
  rankDir: 'TB' | 'LR';
  graphRef?: React.RefObject<GraphMutation | null>;
}

const STYLESHEET: NonNullable<cytoscape.CytoscapeOptions['style']> = [
  {
    selector: 'edge',
    style: {
      'target-arrow-shape': 'triangle',
      'line-color': '#666',
      'target-arrow-color': '#666',
      'curve-style': 'bezier',
      width: 1.5,
    },
  },
  {
    selector: 'node[type="node"]',
    style: {
      content: 'data(label)',
      shape: 'round-rectangle',
      'background-color': '#1e293b',
      'border-color': '#3b82f6',
      'border-width': 1.5,
      padding: '8px',
      'font-size': '12px',
      color: '#3b82f6',
      'text-valign': 'center',
      'text-halign': 'center',
    },
  },
  {
    selector: 'node[type="topic"]',
    style: {
      content: 'data(label)',
      shape: 'diamond',
      'background-color': '#4c1d95',
      'border-color': '#8b5cf6',
      'border-width': 1,
      'font-size': '11px',
      color: '#fff',
      'text-valign': 'center',
      'text-halign': 'center',
      padding: '10px',
    },
  },
];

function applyLeftRightOrientation(cy: cytoscape.Core): void {
  cy.nodes().positions((node) => {
    const pos = node.position();
    return { x: pos.y, y: pos.x };
  });
  cy.fit(undefined, 30);
}

function createBreadthfirstLayout(
  cy: cytoscape.Core,
  rankDir: 'TB' | 'LR',
): cytoscape.LayoutOptions {
  const publisherRoots = cy.nodes('[type="node"]');
  return {
    name: 'breadthfirst',
    fit: rankDir === 'TB',
    directed: true,
    padding: 30,
    spacingFactor: 1.2,
    grid: true,
    avoidOverlap: true,
    ...(publisherRoots.length > 0 ? { roots: publisherRoots } : {}),
    stop: () => {
      if (rankDir === 'LR') {
        applyLeftRightOrientation(cy);
      }
    },
  };
}

export const Graph: React.FC<GraphProps> = ({ elements, rankDir, graphRef }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  const runLayout = useCallback((cy: cytoscape.Core, direction: 'TB' | 'LR') => {
    cy.layout(createBreadthfirstLayout(cy, direction)).run();
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: STYLESHEET,
      userZoomingEnabled: true,
      userPanningEnabled: true,
    });

    cyRef.current = cy;
    runLayout(cy, rankDir);

    if (graphRef) {
      graphRef.current = {
        fit: () => cy.fit(undefined, 30),
      };
    }

    return () => {
      cy.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only init; elements/rankDir updates use the effect below
  }, []);

  useEffect(() => {
    if (!cyRef.current) return;

    cyRef.current.batch(() => {
      cyRef.current?.elements().remove();
      cyRef.current?.add(elements);
      if (cyRef.current) {
        runLayout(cyRef.current, rankDir);
      }
    });
  }, [elements, rankDir, runLayout]);

  return <div ref={containerRef} className="w-full h-full bg-background" />;
};
