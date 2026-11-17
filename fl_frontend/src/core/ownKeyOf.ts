/**
 * An object type whose every key it declares is one its value holds: an optional key, or an index signature, names
 * keys a value may lack, so `false` would narrow away a key the type names.
 */
type DeclaredKeys<O> = string extends keyof O ? never : number extends keyof O ? never : { [K in keyof O]-?: unknown };

/**
 * Whether `key` is one of `object`'s own keys, typed as that object's keys: the one hand-written type predicate,
 * which TypeScript cannot infer from `Object.hasOwn`, tied to its test by `O` alone. A predicate calling it is
 * inferred, and so checked by the compiler. An object literal's own keys are the keys its type declares, so each one
 * handed is a literal typed as itself: a class instance's methods are keys of its type that `Object.hasOwn` refuses,
 * and a value holding own keys beyond its type's, which a wider value's assignment admits, would type an extra key as
 * one of them.
 */
export function ownKeyOf<O extends DeclaredKeys<O>>(object: O, key: PropertyKey): key is keyof O {
  return Object.hasOwn(object, key);
}
