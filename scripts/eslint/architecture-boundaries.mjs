const EFFECTS = new Set(['useEffect', 'useLayoutEffect']);
const NETWORK = new Set(['fetch', 'WebSocket']);
const GLOBAL_OBJECTS = new Set(['globalThis', 'window', 'self']);

function staticKey(node, computed = false) {
  if (!computed && node.type === 'Identifier') return node.name;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  return null;
}

function unwrap(node) {
  while (
    node &&
    ['ChainExpression', 'TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression'].includes(
      node.type,
    )
  )
    node = node.expression;
  return node;
}

function binding(source, identifier) {
  let scope = source.getScope(identifier);
  while (scope) {
    const variable = scope.set.get(identifier.name);
    if (variable) return variable;
    scope = scope.upper;
  }
  return null;
}

function reactImport(variable) {
  const definition = variable?.defs[0];
  if (definition?.type !== 'ImportBinding' || definition.parent.source.value !== 'react')
    return null;
  const specifier = definition.node;
  if (specifier.importKind === 'type' || definition.parent.importKind === 'type') return null;
  return specifier.type === 'ImportSpecifier' ? staticKey(specifier.imported) : 'react-namespace';
}

/** Follow only static, unreassigned namespace bindings; never treat client.fetch as global I/O. */
function namespace(source, expression, seen = new Set()) {
  const node = unwrap(expression);
  if (!node) return null;
  if (node.type === 'MemberExpression') {
    const owner = namespace(source, node.object, seen);
    return owner === 'global' && GLOBAL_OBJECTS.has(staticKey(node.property, node.computed))
      ? 'global'
      : null;
  }
  if (node.type !== 'Identifier') return null;
  const variable = binding(source, node);
  if (!variable?.defs.length) return GLOBAL_OBJECTS.has(node.name) ? 'global' : null;
  if (reactImport(variable) === 'react-namespace') return 'react';
  if (seen.has(variable) || variable.references.some((ref) => ref.isWrite() && !ref.init))
    return null;
  seen.add(variable);
  const definition = variable.defs[0];
  if (definition?.type !== 'Variable' || definition.node.type !== 'VariableDeclarator') return null;
  const declarator = definition.node;
  if (declarator.id.type === 'Identifier') return namespace(source, declarator.init, seen);
  if (declarator.id.type !== 'ObjectPattern') return null;
  const owner = namespace(source, declarator.init, seen);
  for (const property of declarator.id.properties) {
    if (property.type !== 'Property') continue;
    const value =
      property.value.type === 'AssignmentPattern' ? property.value.left : property.value;
    if (
      value === definition.name &&
      owner === 'global' &&
      GLOBAL_OBJECTS.has(staticKey(property.key, property.computed))
    )
      return 'global';
  }
  return null;
}

function isTypePosition(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type === 'TSTypeQuery' || parent.type === 'TSImportType') return true;
    if (parent.type === 'Statement' || parent.type.endsWith('Statement')) return false;
  }
  return false;
}

function isWriteOnly(node) {
  const parent = node.parent;
  return (
    (parent?.type === 'AssignmentExpression' && parent.left === node && parent.operator === '=') ||
    (parent?.type === 'UnaryExpression' && parent.operator === 'delete')
  );
}

function capabilityRule(kind) {
  const names = kind === 'effect' ? EFFECTS : NETWORK;
  const owner = kind === 'effect' ? 'react' : 'global';
  return {
    meta: {
      type: 'problem',
      schema: [],
      messages: {
        boundary:
          kind === 'effect'
            ? 'views/ 禁止 React {{name}} 引用，副作用移至 hooks/ 层（07 §3 规则 2）'
            : '{{name}} 网络能力只允许出现在 services/ 层（07 §3 规则 5）',
      },
    },
    create(context) {
      const source = context.sourceCode;
      const members = [];
      const patterns = [];
      const report = (node, name) =>
        context.report({ node, messageId: 'boundary', data: { name } });
      return {
        MemberExpression(node) {
          members.push(node);
        },
        VariableDeclarator(node) {
          if (node.id.type === 'ObjectPattern') patterns.push([node.id, node.init]);
        },
        AssignmentExpression(node) {
          if (node.left.type === 'ObjectPattern') patterns.push([node.left, node.right]);
        },
        'Program:exit'() {
          for (const scope of source.scopeManager.scopes) {
            for (const reference of scope.references) {
              const node = reference.identifier;
              if (!reference.isRead() || reference.isTypeReference || isTypePosition(node))
                continue;
              const name =
                kind === 'effect'
                  ? reactImport(reference.resolved)
                  : !reference.resolved?.defs.length
                    ? node.name
                    : null;
              if (names.has(name)) report(node, name);
            }
          }
          for (const node of members) {
            if (isTypePosition(node) || isWriteOnly(node)) continue;
            const name = staticKey(node.property, node.computed);
            if (names.has(name) && namespace(source, node.object) === owner) report(node, name);
          }
          for (const [pattern, value] of patterns) {
            if (namespace(source, value) !== owner) continue;
            for (const property of pattern.properties) {
              if (property.type !== 'Property') continue;
              const name = staticKey(property.key, property.computed);
              if (names.has(name)) report(property, name);
            }
          }
        },
      };
    },
  };
}

export default {
  rules: {
    'no-view-effects': capabilityRule('effect'),
    'no-network-capabilities': capabilityRule('network'),
  },
};
