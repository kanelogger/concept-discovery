// rc-input's autosize probe uses setAttribute('style'), which strict style-src
// rejects. Preserve its cached sizing values, applying trusted properties via
// CSSOM instead; no unsafe-inline policy or node_modules mutation is needed.
export function adaptTextareaCSP(source) {
  const replacements = [
    ["const sizingStyle = SIZING_STYLE.map(name => `${name}:${style.getPropertyValue(name)}`).join(';');",
      "const sizingProperties = Object.fromEntries(SIZING_STYLE.map(name => [name, style.getPropertyValue(name)]));\n  const sizingStyle = SIZING_STYLE.map(name => `${name}:${sizingProperties[name]}`).join(';');"],
    ["    sizingStyle,\n    paddingSize,", "    sizingStyle,\n    sizingProperties,\n    paddingSize,"],
    ["    sizingStyle\n  } = calculateNodeStyling", "    sizingStyle,\n    sizingProperties\n  } = calculateNodeStyling"],
    ["hiddenTextarea.setAttribute('style', `${sizingStyle};${HIDDEN_TEXTAREA_STYLE}`);", `for (const [name, value] of Object.entries(sizingProperties)) hiddenTextarea.style.setProperty(name, value);
  for (const [name, value] of Object.entries({ 'min-height':'0', 'max-height':'none', height:'0', visibility:'hidden', overflow:'hidden', position:'absolute', 'z-index':'-1000', top:'0', right:'0', 'pointer-events':'none' })) hiddenTextarea.style.setProperty(name, value, 'important');`],
  ];
  for (const [before, after] of replacements) {
    if (!source.includes(before)) throw new Error('Review the rc-input textarea CSP adapter after upgrading the dependency');
    source = source.replace(before, after);
  }
  return source;
}
