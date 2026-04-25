// Hudson Valuation Group — script.js
document.querySelectorAll('[id="year"]').forEach(el => {
  el.textContent = new Date().getFullYear();
});
// Set current year in all year spans
document.querySelectorAll('.year').forEach(el => {
  el.textContent = new Date().getFullYear();
});
