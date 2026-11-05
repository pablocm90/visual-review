import type { Dimension } from '../core/findings.ts';

export const LENSES = ['Behaviour', 'Contract', 'Risk', 'Shape', 'Context'] as const;

export type Lens = (typeof LENSES)[number];

export const LENS_OF: Readonly<Record<Dimension, Lens>> = {
  logic: 'Behaviour',
  tests: 'Behaviour',
  failure: 'Behaviour',
  performance: 'Behaviour',
  api: 'Contract',
  'blast-radius': 'Contract',
  routes: 'Contract',
  schema: 'Contract',
  security: 'Risk',
  tenancy: 'Risk',
  deploy: 'Risk',
  dependencies: 'Risk',
  structure: 'Shape',
  rules: 'Shape',
  cohesion: 'Shape',
  metrics: 'Context',
  ownership: 'Context',
};
