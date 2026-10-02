const dns = require('dns');

console.log('Default DNS servers:', dns.getServers());

dns.resolveSrv('_mongodb._tcp.cluster0.yvhpxeg.mongodb.net', (err, addresses) => {
  if (err) {
    console.error('Default DNS failed:', err.message);
    console.log('Testing with 8.8.8.8...');
    dns.setServers(['8.8.8.8', '8.8.4.4']);
    dns.resolveSrv('_mongodb._tcp.cluster0.yvhpxeg.mongodb.net', (err2, addresses2) => {
      if (err2) {
        console.error('Google DNS also failed:', err2.message);
      } else {
        console.log('Google DNS success! Addresses:', addresses2);
      }
    });
  } else {
    console.log('Default DNS success! Addresses:', addresses);
  }
});
