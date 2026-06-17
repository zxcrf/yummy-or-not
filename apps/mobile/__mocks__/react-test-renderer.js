/**
 * react-test-renderer wrapper — adds ReactTestInstance.prototype.toJSON.
 *
 * react-test-renderer v19 exposes toJSON() only on the root renderer object,
 * not on individual ReactTestInstance nodes returned by .find(). This wrapper
 * patches the prototype once (lazily, on the first .root access after a
 * renderer is created) so that assertions like:
 *   renderer.root.find(n => n.props.testID === 'foo').toJSON()
 * work correctly in tests that need it.
 *
 * NOTE: jest.requireActual() would recurse into this file via moduleNameMapper.
 * We require the real CJS entry directly by path instead.
 */

const realPath = require.resolve(
  'react-test-renderer/cjs/react-test-renderer.development.js',
)
const TestRenderer = require(realPath)

let _protocolPatched = false

const origCreate = TestRenderer.create.bind(TestRenderer)

TestRenderer.create = function createWithToJSONPatch(element, options) {
  const renderer = origCreate(element, options)

  if (_protocolPatched) return renderer

  // The renderer returned by create() has an own-property `root` defined via
  // Object.defineProperty (a getter that throws if the tree is unmounted or
  // empty). We install our OWN own-property getter on top of it for one access,
  // grab the ReactTestInstance prototype, patch toJSON(), then RESTORE the
  // original own-property descriptor so all future .root accesses work normally.
  const ownDescriptor = Object.getOwnPropertyDescriptor(renderer, 'root')
  if (ownDescriptor == null) return renderer

  Object.defineProperty(renderer, 'root', {
    configurable: true,
    enumerable: true,
    get() {
      // Restore the original own-property descriptor FIRST, before calling
      // the original getter — so that if the getter itself accesses `this.root`
      // recursively (it doesn't, but be safe) we don't loop.
      Object.defineProperty(renderer, 'root', ownDescriptor)

      // Call the real getter to get the ReactTestInstance.
      const inst = ownDescriptor.get.call(renderer)

      if (!_protocolPatched) {
        _protocolPatched = true
        const proto = Object.getPrototypeOf(inst)
        if (typeof proto.toJSON !== 'function') {
          proto.toJSON = function toJSON() {
            return serializeNode(this)
          }
        }
      }

      return inst
    },
  })

  return renderer
}

function serializeNode(node) {
  if (typeof node.type === 'string') {
    // Host element (View, Text, Pressable, etc.) — emit a plain JSON object.
    const props = {}
    for (const [k, v] of Object.entries(node.props ?? {})) {
      if (k !== 'children') props[k] = v
    }
    const children = (node.children ?? [])
      .map((child) => (typeof child === 'string' ? child : serializeNode(child)))
      .filter((c) => c != null)
    return {
      type: node.type,
      props,
      children: children.length === 0 ? null : children,
    }
  }
  // Composite component — transparent, descend into children.
  const kids = node.children ?? []
  if (kids.length === 0) return null
  if (kids.length === 1) return serializeNode(kids[0])
  return kids.map(serializeNode).filter((c) => c != null)
}

module.exports = TestRenderer
