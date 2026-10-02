async function verify() {
  const resNew = await fetch('http://127.0.0.1:3000/quotation/new');
  const htmlNew = await resNew.text();
  console.log('=== /quotation/new (Step 1) ===');
  console.log('Status:', resNew.status);
  console.log('Contains <select: ', htmlNew.includes('<select'));
  console.log('Contains aria-haspopup="listbox": ', htmlNew.includes('aria-haspopup="listbox"'));
  console.log('Contains Select Project Type: ', htmlNew.includes('Select Project Type'));

  const resReview = await fetch('http://127.0.0.1:3000/quotation/q_mumbjcwc_9ynsm54?step=4');
  const htmlReview = await resReview.text();
  console.log('\n=== /quotation/q_mumbjcwc_9ynsm54?step=4 (Step 4 Review) ===');
  console.log('Status:', resReview.status);
  console.log('Contains <select: ', htmlReview.includes('<select'));
  console.log('Contains "each": ', htmlReview.includes('each'));
  console.log('Contains "Change": ', htmlReview.includes('Change'));
  console.log('Contains "Remove": ', htmlReview.includes('Remove'));
  console.log('Contains "Installation": ', htmlReview.includes('Installation'));
  console.log('Contains 3-column layout (md:col-span-6): ', htmlReview.includes('md:col-span-6'));
  console.log('Contains 3-column layout (md:col-span-3): ', htmlReview.includes('md:col-span-3'));

  const resStep3 = await fetch('http://127.0.0.1:3000/quotation/q_mumbjcwc_9ynsm54?step=3');
  const htmlStep3 = await resStep3.text();
  console.log('\n=== /quotation/q_mumbjcwc_9ynsm54?step=3 (Step 3 Product Config) ===');
  console.log('Status:', resStep3.status);
  console.log('Contains <select: ', htmlStep3.includes('<select'));
  console.log('Contains aria-haspopup="listbox": ', htmlStep3.includes('aria-haspopup="listbox"'));
}

verify().catch(console.error);
