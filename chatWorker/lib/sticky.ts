import net = require('net');
import cluster = require('cluster');
import _ = require('lodash');

// Copied from the great module of indutny : sticky-session
// https://github.com/indutny/sticky-session
// Modified to implement a truly random routing, for benchmark purpose

function hash(ip, seed) {
  var hash = ip.reduce(function(r, num) {
    r += parseInt(num, 10);
    r %= 2147483648;
    r += (r << 10)
    r %= 2147483648;
    r ^= r >> 6;
    return r;
  }, seed);

  hash += hash << 3;
  hash %= 2147483648;
  hash ^= hash >> 11;
  hash += hash << 15;
  hash %= 2147483648;

  return hash >>> 0;
}

interface StickyOptions {
  threads?: number;
  sticky?: boolean;
}

var defaultOptions: StickyOptions = {
  threads: require('os').cpus().length,
  sticky: true
}

var sticky = function(callback, opt: StickyOptions) {

  var options: StickyOptions = _.defaults(opt, defaultOptions);

  var server;

  // Master will spawn `num` workers
  if (cluster.isMaster) {
    var workers = [];
    for (var i = 0; i < options.threads; i++) {
      !function spawn(i) {
        workers[i] = cluster.fork();
        // Restart worker on exit
        workers[i].on('exit', function() {
          console.error('sticky-session: worker died');
          spawn(i);
        });
      }(i);
    }

    var seed = ~~(Math.random() * 1e9);
    server = net.createServer(function(c) {
      // Get int31 hash of ip
      var worker;

      if (options.sticky) {
        var ipHash = hash((c.remoteAddress || '').split(/\./g), seed);
        worker = workers[ipHash % workers.length];
      } else {
        worker = _.sample(workers);
      }
      
      worker.send('sticky-session:connection', c);
    });
  } else {
    server = typeof callback === 'function' ? callback() : callback;

    // Worker process
    process.on('message', function(msg, socket) {
      if (msg !== 'sticky-session:connection') return;

      server.emit('connection', socket);
    });

    if (!server) throw new Error('Worker hasn\'t created server!');

    // Monkey patch server to do not bind to port
    var oldListen = server.listen;
    server.listen = function listen() {
      var lastArg = arguments[arguments.length - 1];

      if (typeof lastArg === 'function') lastArg();

      return oldListen.call(this, null);
    };
  }

  return server;
};

export = sticky;