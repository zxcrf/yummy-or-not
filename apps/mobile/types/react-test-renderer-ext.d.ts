/**
 * Type augmentation — adds toJSON() to ReactTestInstance.
 *
 * react-test-renderer v19 only defines toJSON() on the root ReactTestRenderer
 * object, not on individual ReactTestInstance nodes returned by .find().
 * Our __mocks__/react-test-renderer.js patches the prototype at runtime;
 * this declaration makes TypeScript aware of the method so tests can call
 * instance.toJSON() without type errors.
 */
import 'react-test-renderer'

declare module 'react-test-renderer' {
  interface ReactTestInstance {
    /**
     * Serialize this node's subtree into the same plain-object shape that
     * ReactTestRenderer.toJSON() produces, scoped to just this node.
     * Patched onto ReactTestInstance.prototype by __mocks__/react-test-renderer.js.
     */
    toJSON(): import('react-test-renderer').ReactTestRendererJSON | null
  }
}
