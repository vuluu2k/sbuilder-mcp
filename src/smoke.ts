/**
 * Offline self-test. No network, no MCP transport — just the pure logic, so a
 * broken build fails before anything is published. Must end with ALL GOOD.
 */
import { text } from './mcp/response.js';
import { createServer, pkgVersion } from './server.js';
import { API_OPERATIONS } from './catalog/api.generated.js';
import { searchOperations, describeOperation } from './catalog/search.js';
import { credentialFor } from './transport/credential.js';

function check(label: string, ok: boolean): void {
  if (!ok) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  console.error(`ok: ${label}`);
}

export async function runSmoke(): Promise<void> {
  check('text() wraps a string', text('x').content[0].text === 'x');
  check('pkgVersion() is not empty', pkgVersion().length > 0);
  check('createServer() builds', createServer() !== null);

  check('API index has 300+ operations', API_OPERATIONS.length > 300);
  check(
    'every operation has a credential',
    API_OPERATIONS.every((o) => ['apiKey', 'siteScoped', 'none'].includes(o.credential)),
  );
  check(
    'every credential matches the routing rule',
    API_OPERATIONS.every((o) => o.credential === credentialFor(o.path)),
  );
  check('search finds menu operations', searchOperations('menu').length > 0);
  check('search returns nothing for nonsense', searchOperations('zzzzqqqq').length === 0);
  check(
    'no operation reports both body verdicts at once',
    API_OPERATIONS.every((o) => {
      const d = describeOperation(o) as Record<string, unknown>;
      return !(d.body_warning !== undefined && d.body_note !== undefined);
    }),
  );

  const { ELEMENTS, ELEMENT_SOURCE } = await import('./catalog/elements.generated.js');
  check('element catalog is populated', Object.keys(ELEMENTS).length === ELEMENT_SOURCE.count);
  check(
    'every element carries AI hints',
    Object.values(ELEMENTS).every((e) => e.description.length > 0),
  );

  // An end-to-end pass through the document core: build a section with a child,
  // and assert the result is something the platform would actually store.
  const { PageDoc } = await import('./domains/site/document.js');
  const { addSubtree, setKeys } = await import('./domains/site/builder.js');
  const { validateForSave } = await import('./domains/site/validate.js');
  const doc = PageDoc.from({
    schema_version: 2,
    root_node_id: 'rt',
    nodes: {
      rt: {
        id: 'rt',
        data: { type: 'root', parent: null, nodes: [], isCanvas: true, hidden: false, custom: {} },
        style: {}, config: {}, specials: {}, responsive: {}, events: [], bindings: [],
      },
    },
  });
  const built = addSubtree(doc, 'rt', { type: 'flex-section', children: [{ type: 'heading' }] });
  doc.apply(built.patches);
  check('builder linked the subtree', doc.outline({ depth: 2 })[0].kids?.length === 1);
  check('builder produces a storable document', validateForSave(doc).length === 0);

  doc.apply(setKeys(doc, built.ids[0], { gap: '24px' }, { namespace: 'style' }));
  const section = doc.node(built.ids[0]) as unknown as {
    responsive: Record<string, { style?: Record<string, unknown> }>;
    style: Record<string, unknown>;
  };
  check('sb_set writes per breakpoint, not at base', section.responsive.desktop?.style?.gap === '24px' && section.style.gap === undefined);

  doc.apply(setKeys(doc, built.ids[0], { maxWidth: '1200px' }, { namespace: 'style', base: true }));
  const seeded = doc.node(built.ids[0]) as unknown as { style: Record<string, unknown> };
  check('a base style is written, not refused', seeded.style.maxWidth === '1200px');

  const { BINDING_SOURCES } = await import('./catalog/elements.generated.js');
  check('binding sources are populated', BINDING_SOURCES.length > 15);

  const { bindNode } = await import('./tools/live.js');
  const bd = PageDoc.from({
    schema_version: 2,
    root_node_id: 'rt',
    nodes: {
      rt: {
        id: 'rt',
        data: { type: 'root', parent: null, nodes: ['he_1'], isCanvas: true, hidden: false, custom: {} },
        style: {}, config: {}, specials: {}, responsive: {}, events: [], bindings: [],
      },
      he_1: {
        id: 'he_1',
        data: { type: 'heading', parent: 'rt', nodes: [], isCanvas: false, hidden: false, custom: {} },
        style: {}, config: {}, specials: {}, responsive: {}, events: [], bindings: [],
      },
    },
  });
  bd.apply(bindNode(bd, 'he_1', 'product.title', 'specials.text'));
  check(
    'a valid binding lands',
    (bd.node('he_1') as unknown as { bindings: unknown[] }).bindings.length === 1,
  );

  let bindRefused = false;
  try {
    bindNode(bd, 'he_1', 'product.title', 'style.color');
  } catch {
    bindRefused = true;
  }
  check('a non-specials binding field is REFUSED', bindRefused);

  const { reviewDesign } = await import('./domains/site/review.js');
  // Fill the heading before claiming the section is finished. The first version
  // of this check asserted the section built above was clean; it was not — the
  // heading still carried the placeholder the element ships with, and the
  // reviewer said so. The check was wrong, not the reviewer.
  doc.apply(setKeys(doc, built.ids[1], { text: 'Autumn sale' }, { namespace: 'specials' }));
  check('a finished section reviews clean', reviewDesign(doc).length === 0);
  // ...and an unfilled one must. A reviewer that never fires is indistinguishable
  // from one that is not wired up.
  const { addSubtree: add2 } = await import('./domains/site/builder.js');
  doc.apply(add2(doc, 'rt', { type: 'flex-section', children: [{ type: 'text' }] }).patches);
  const codes = reviewDesign(doc).map((f) => f.code);
  check('an unfilled placeholder IS reported', codes.includes('placeholder_content'));


  // A REPEATER ARRIVES WITH ITS EMPTY STATE.
  //
  // On its OWN document, because a repeater with no card template is a genuinely
  // empty container and would answer the review check below with a finding it is
  // right to make.
  //
  // The satellite hangs off `config.emptyStateId`, not the child list, so every
  // walk that follows children only reports this document as correct while the
  // renderer takes its degrade path and ships ghost cards to a shopper.
  const satDoc = PageDoc.from({
    schema_version: 2,
    root_node_id: 'rt',
    nodes: {
      rt: {
        id: 'rt',
        data: { type: 'root', parent: null, nodes: [], isCanvas: true, hidden: false, custom: {} },
        style: {}, config: {}, specials: {}, responsive: {}, events: [], bindings: [],
      },
    },
  });
  const satSection = addSubtree(satDoc, 'rt', { type: 'flex-section' });
  satDoc.apply(satSection.patches);
  const listed = addSubtree(satDoc, satSection.ids[0], { type: 'list-dataset' });
  satDoc.apply(listed.patches);
  const list = satDoc.node(listed.ids[0]) as unknown as { config: Record<string, unknown> };
  const emptyId = list.config.emptyStateId;
  check(
    'a repeater is minted with its empty state',
    typeof emptyId === 'string' && satDoc.has(emptyId) && satDoc.node(emptyId).data.type === 'list-empty',
  );
  check(
    'the empty state carries its design, not a blank box',
    satDoc.node(String(emptyId)).data.nodes.length === 3,
  );
  check('a document carrying satellites still stores', validateForSave(satDoc).length === 0);
  console.error('ALL GOOD');
}

runSmoke().catch((err) => {
  console.error('smoke threw:', err);
  process.exit(1);
});
