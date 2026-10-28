const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'game', 'assets', 'script', 'model', 'info');

for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.ts')) continue;
    const full = path.join(dir, file);
    let content = fs.readFileSync(full, 'utf8');
    const original = content;
    content = content.replace(
        /^import app\.buildingInfoCreateMgr\.(\w+) from /gm,
        'import $1 from '
    );
    if (content !== original) {
        fs.writeFileSync(full, content, 'utf8');
        console.log('fixed', file);
    }
}
