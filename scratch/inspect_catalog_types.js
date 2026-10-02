const mongoose = require('mongoose');

async function run() {
  await mongoose.connect('mongodb://127.0.0.1:27017/whyte_quotation');
  const db = mongoose.connection.db;

  const products = await db.collection('products').find({}).sort({ _id: 1 }).toArray();
  console.log(`Total Products in DB: ${products.length}`);

  // Let's inspect unique product name patterns
  const types = {};
  products.forEach(p => {
    types[p.type] = (types[p.type] || 0) + 1;
  });
  console.log('Current types distribution:', types);

  // Let's search for keywords in product names/descriptions
  const curtains = [];
  const remotes = [];
  const gateways = [];
  const sockets = [];
  const controllers = [];
  const bells = [];
  const dimmers = [];
  const switches = [];
  const other = [];

  for (const p of products) {
    const desc = (p.name + ' ' + (p.description || '')).toLowerCase();
    if (desc.includes('curtain')) {
      curtains.push(p);
    } else if (desc.includes('gateway')) {
      gateways.push(p);
    } else if (desc.includes('remote') && !desc.includes('regulator') && !desc.includes('switch')) {
      remotes.push(p);
    } else if (desc.includes('socket') || desc.includes('usb')) {
      sockets.push(p);
    } else if (desc.includes('scene') || desc.includes('controller')) {
      controllers.push(p);
    } else if (desc.includes('bell')) {
      bells.push(p);
    } else if (desc.includes('dimmer')) {
      dimmers.push(p);
    } else if (desc.includes('switch')) {
      switches.push(p);
    } else {
      other.push(p);
    }
  }

  console.log(`\nKeyword breakdowns:`);
  console.log(`Curtains: ${curtains.length} products`);
  curtains.forEach(p => console.log(`  [ID ${p._id}] ${p.name} (${p.moduleSize})`));

  console.log(`\nGateways: ${gateways.length} products`);
  gateways.forEach(p => console.log(`  [ID ${p._id}] ${p.name} (${p.moduleSize})`));

  console.log(`\nRemotes: ${remotes.length} products`);
  remotes.forEach(p => console.log(`  [ID ${p._id}] ${p.name} (${p.moduleSize})`));

  console.log(`\nControllers / Scenes: ${controllers.length} products`);
  controllers.slice(0, 10).forEach(p => console.log(`  [ID ${p._id}] ${p.name} (${p.moduleSize})`));

  console.log(`\nSockets & USBs: ${sockets.length} products`);
  sockets.slice(0, 10).forEach(p => console.log(`  [ID ${p._id}] ${p.name} (${p.moduleSize})`));

  console.log(`\nBells: ${bells.length} products`);
  bells.forEach(p => console.log(`  [ID ${p._id}] ${p.name} (${p.moduleSize})`));

  console.log(`\nDimmers: ${dimmers.length} products`);
  dimmers.forEach(p => console.log(`  [ID ${p._id}] ${p.name} (${p.moduleSize})`));

  console.log(`\nOther: ${other.length} products`);
  other.forEach(p => console.log(`  [ID ${p._id}] ${p.name} (${p.moduleSize})`));

  await mongoose.disconnect();
}

run();
