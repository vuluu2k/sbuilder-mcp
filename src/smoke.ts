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
    API_OPERATIONS.every((o) => ['apiKey', 'session', 'none'].includes(o.credential)),
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

  let refused = false;
  try {
    setKeys(doc, built.ids[0], { gap: '1px' }, { namespace: 'style', base: true });
  } catch {
    refused = true;
  }
  check('a base-only write of a quantity is REFUSED', refused);

  console.error('ALL GOOD');
}

runSmoke().catch((err) => {
  console.error('smoke threw:', err);
  process.exit(1);
});
