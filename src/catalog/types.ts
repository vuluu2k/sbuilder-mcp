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

export interface ShapeField {
  name: string;
  type: string;
  /**
   * A nested struct's own fields, one level down.
   *
   * WITHOUT THIS A PRODUCT CANNOT BE PRICED: `POST /api/v1/products` takes
   * `variants: VariantInput[]`, and price lives on the variant — `products.Product`
   * has no price column at all.
   */
  fields?: ShapeField[];
  /**
   * The field's own doc comment, trimmed to its first sentence plus any sentence
   * that shouts. The shouting is where this platform keeps the knowledge that
   * decides a body: "ZERO MEANS 'never free', not 'always free'".
   */
  note?: string;
}

/**
 * What a write operation's body carries, read off the handler that decodes it.
 *
 * `swagger.json` describes 46 of 211 write bodies; this covers the rest. See
 * `scripts/shapes.ts` for how, and why the decode site is the more accurate of
 * the two sources rather than merely the broader one.
 */
export interface RequestShape {
  fields: ShapeField[];
  /** Fields the platform owns — present on a read, refused or ignored on a write. */
  readOnly?: string[];
  source: 'go';
  /** The Go type, for a reader who wants to go and look. */
  goType: string;
}
