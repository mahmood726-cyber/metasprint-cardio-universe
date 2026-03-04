export function byId(id, root = document) {
  return root.getElementById(id);
}

export function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function setText(node, value) {
  node.textContent = String(value ?? '');
}

export function el(tag, options = {}) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text != null) node.textContent = String(options.text);
  if (options.attrs) {
    for (const [key, val] of Object.entries(options.attrs)) {
      if (val == null) continue;
      node.setAttribute(key, String(val));
    }
  }
  return node;
}

export function append(node, ...children) {
  for (const child of children) {
    if (child == null) continue;
    node.appendChild(child);
  }
  return node;
}
