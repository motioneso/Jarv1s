/* Shared Lucide icon helper for the Jarvis UI kit. Exposes window.Ic. */
(function () {
  function Ic({ n, s = 18, color }) {
    const data = window.lucide && window.lucide.icons ? window.lucide.icons[n] : null;
    if (!data) return null;
    const node = window.lucide.createElement(data);
    node.setAttribute("width", s);
    node.setAttribute("height", s);
    if (color) node.setAttribute("stroke", color);
    return React.createElement("span", {
      style: { display: "inline-flex" },
      dangerouslySetInnerHTML: { __html: node.outerHTML }
    });
  }
  window.Ic = Ic;
})();
