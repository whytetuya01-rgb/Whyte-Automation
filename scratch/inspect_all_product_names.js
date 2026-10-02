const mongoose = require('mongoose');

async function run() {
  await mongoose.connect('mongodb://127.0.0.1:27017/whyte_quotation');
  const products = await mongoose.connection.db.collection('products').find({}).sort({ _id: 1 }).toArray();

  console.log('Total products:', products.length);
  // Filter for products that do NOT contain 'switch' in name
  const nonSwitch = products.filter(p => !p.name.toLowerCase().includes('switch'));
  console.log(`\nProducts without "switch" in name (${nonSwitch.length}):`);
  for (const p of nonSwitch) {
    console.log(`  ID ${p._id}: "${p.name}" | Cat: ${p.categoryId} | Type: ${p.type} | Mod: ${p.moduleSize}`);
  }

  // Also check products with 'switch' that might be curtain or something else
  const specialSwitches = products.filter(p => {
    const n = p.name.toLowerCase();
    return n.includes('curtain') || n.includes('bell') || n.includes('dimmer') || n.includes('scene') || n.includes('master');
  });
  console.log(`\nSpecial switches (${specialSwitches.length}):`);
  for (const p of specialSwitches) {
    console.log(`  ID ${p._id}: "${p.name}" | Cat: ${p.categoryId} | Type: ${p.type} | Mod: ${p.moduleSize}`);
  }

  // Let's also check if there are any other products that don't have Fan or Socket in name
  const otherNames = products.filter(p => {
    const n = p.name.toLowerCase();
    return !n.includes('switch') && !n.includes('socket') && !n.includes('charger') && !n.includes('gateway') && !n.includes('remote');
  });
  console.log(`\nAny other unexpected products (${otherNames.length}):`);
  for (const p of otherNames) {
    console.log(`  ID ${p._id}: "${p.name}" | Cat: ${p.categoryId} | Type: ${p.type}`);
  }

  await mongoose.disconnect();
}
run();
