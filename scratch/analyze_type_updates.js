const mongoose = require('mongoose');

async function run() {
  await mongoose.connect('mongodb://127.0.0.1:27017/whyte_quotation');
  const db = mongoose.connection.db;

  const products = await db.collection('products').find({}).sort({ _id: 1 }).toArray();

  const curtainIds = [56, 72, 133, 134, 214, 215, 263, 264];
  const accessorySocketUsbIds = [121, 122, 123, 124, 204, 205, 206, 207, 325, 326, 327, 328];
  const gatewayRemoteIds = [17, 125, 126];

  console.log('=== TYPE RECLASSIFICATION PLAN ===');

  console.log(`\n1. CURTAIN CONTROLLERS (${curtainIds.length} products)`);
  console.log(`Current: switch_board -> Correct: curtain`);
  for (const id of curtainIds) {
    const p = products.find(x => x._id === id);
    console.log(`  ID ${p._id}: "${p.name}" | Current type: "${p.type}"`);
  }

  console.log(`\n2. ACCESSORIES - SOCKETS & USB CHARGERS (${accessorySocketUsbIds.length} products)`);
  console.log(`Current: switch_board -> Correct: accessory`);
  for (const id of accessorySocketUsbIds) {
    const p = products.find(x => x._id === id);
    console.log(`  ID ${p._id}: "${p.name}" | Current type: "${p.type}"`);
  }

  console.log(`\n3. ACCESSORIES - GATEWAYS & REMOTES (${gatewayRemoteIds.length} products)`);
  console.log(`Current: accessory -> Correct: accessory (already accessory)`);
  for (const id of gatewayRemoteIds) {
    const p = products.find(x => x._id === id);
    console.log(`  ID ${p._id}: "${p.name}" | Current type: "${p.type}"`);
  }

  const remaining = products.filter(p => 
    !curtainIds.includes(p._id) && 
    !accessorySocketUsbIds.includes(p._id) && 
    !gatewayRemoteIds.includes(p._id)
  );
  console.log(`\n4. SWITCH BOARDS (${remaining.length} products)`);
  console.log(`Current: switch_board -> Correct: switch_board (remain switch_board)`);

  console.log(`\nTotal Products: ${curtainIds.length + accessorySocketUsbIds.length + gatewayRemoteIds.length + remaining.length} (Expected: 287)`);

  await mongoose.disconnect();
}

run();
