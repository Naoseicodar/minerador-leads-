const fs = require('fs');
let code = fs.readFileSync('minerar-ireland.js', 'utf8');

// Replacements globais
code = code.replace(/ireland/g, 'portugal');
code = code.replace(/Ireland/g, 'Portugal');
code = code.replace(/IRELAND/g, 'PORTUGAL');
code = code.replace(/\.ie/g, '.pt');
code = code.replace(/en-IE/g, 'pt-PT');
code = code.replace(/COUNTY/g, 'DISTRITO');
code = code.replace(/County/g, 'Distrito');
code = code.replace(/Europe\/Dublin/g, 'Europe/Lisbon');

fs.writeFileSync('minerar-portugal.js', code);
console.log('minerar-portugal.js criado com sucesso!');
