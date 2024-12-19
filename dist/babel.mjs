import { jsxElement, jsxOpeningElement, jsxIdentifier, jsxClosingElement, jsxExpressionContainer, arrowFunctionExpression, jsxFragment, jsxOpeningFragment, jsxClosingFragment } from '@babel/types';

// src/babel/index.ts
function babel_default() {
  let hasLegendImport = false;
  return {
    visitor: {
      ImportDeclaration: {
        enter(path) {
          if (path.node.source.value === "@legendapp/state/react") {
            const specifiers = path.node.specifiers;
            for (let i = 0; i < specifiers.length; i++) {
              const s = specifiers[i].imported.name;
              if (!hasLegendImport && (s === "Computed" || s === "Memo" || s === "Show")) {
                hasLegendImport = true;
                break;
              }
            }
          }
        }
      },
      JSXElement: {
        enter(path) {
          if (!hasLegendImport) {
            return;
          }
          const openingElement = path.node.openingElement;
          const name = openingElement.name.name;
          if (name === "Computed" || name === "Memo" || name === "Show") {
            const children = removeEmptyText(path.node.children);
            if (children.length === 0)
              return;
            if (children[0].type === "JSXElement" || children[0].type === "JSXExpressionContainer" && children[0].expression.type !== "ArrowFunctionExpression" && children[0].expression.type !== "FunctionExpression" && children[0].expression.type !== "MemberExpression" && children[0].expression.type !== "Identifier") {
              const attrs = openingElement.attributes;
              path.replaceWith(
                jsxElement(
                  jsxOpeningElement(jsxIdentifier(name), attrs),
                  jsxClosingElement(jsxIdentifier(name)),
                  [jsxExpressionContainer(arrowFunctionExpression([], maybeWrapFragment(children)))]
                )
              );
            }
          }
        }
      }
    }
  };
}
function maybeWrapFragment(children) {
  if (children.length === 1 && children[0].type == "JSXElement")
    return children[0];
  if (children.length === 1 && children[0].type == "JSXExpressionContainer")
    return children[0].expression;
  return jsxFragment(jsxOpeningFragment(), jsxClosingFragment(), children);
}
function removeEmptyText(nodes) {
  return nodes.filter((node) => !(node.type === "JSXText" && node.value.trim().length === 0));
}

// babel.ts
var babel_default2 = babel_default;

export { babel_default2 as default };
