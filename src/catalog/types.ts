import type { Credential } from '../transport/credential.js';

export interface ApiParam {
  name: string;
  in: 'path' | 'query' | 'body' | 'header' | 'formData';
  required: boolean;
  type: string;
  description: string;
}

export interface ApiOperation {
  /** Synthesized `method:path` — the source document carries no operationId. */
  id: string;
  method: string;
  path: string;
  tags: string[];
  summary: string;
  params: ApiParam[];
  /** False when the body is a loose object with no $ref to resolve. */
  bodyDescribed: boolean;
  /** Definition name (not the full `#/definitions/` ref), or null. */
  bodyRef: string | null;
  credential: Credential;
}
