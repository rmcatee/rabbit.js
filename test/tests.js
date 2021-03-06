var assert = require('assert');

var PARAMS = process.env['AMQP_PARAMS'];
if (PARAMS) {
    try {
        PARAMS = JSON.parse(PARAMS);
    }
    catch (_) {} // assume it's a string and leave as-is
}
else {
    PARAMS = 'amqp://localhost';
}

console.info("Using connection parameters:");
console.info(JSON.stringify(PARAMS));


function withContext(fn) {
    var ctx = require('../index').createContext(PARAMS);
    return fn(ctx);
}

var CTX;
function testWithContext(test) {
    return function(done) { // mocha looks at the number of arguments
        withContext(function(ctx) {
            CTX = ctx;
            CTX.on('ready', function() { return test(done); });
        });
    };
}

var suite = module.exports;

suite.trivialOpenContext = testWithContext(function(done) {
    done();
});

suite.simplestPushPull = testWithContext(function(done) {
    var push = CTX.socket('PUSH');
    var pull = CTX.socket('PULL');
    pull.setEncoding('utf8');
    pull.on('data', function(msg) {
        assert.equal('foo', msg);
        done();
    });

    push.connect('testPushPull', function() {
        pull.connect('testPushPull', function() {
            push.write('foo');
        });
    });
});

suite.simplestPubSub = testWithContext(function(done) {
    var pub = CTX.socket('PUB');
    var sub = CTX.socket('SUB');
    sub.setEncoding('utf8');
    sub.on('data', function(msg) {
        assert.equal('foo', msg);
        done();
    });

    sub.connect('testPubSub', function() {
        pub.connect('testPubSub', function() {
            pub.write('foo');
        });
    });
});

suite.simplestReqRep = testWithContext(function(done) {
    var req = CTX.socket('REQ');
    var rep = CTX.socket('REP');

    rep.setEncoding('utf8');
    rep.on('data', function(msg) {
        assert.equal('question', msg);
        rep.write('answer');
    });

    req.setEncoding('utf8');
    req.on('data', function(msg) {
        assert.equal('answer', msg);
        done();
    });

    req.connect('testReqRep', function() {
        rep.connect('testReqRep', function() {
            req.write('question');
        });
    });
});

suite.allSubs = testWithContext(function(done) {
    var subs = [CTX.socket('SUB'), CTX.socket('SUB'), CTX.socket('SUB')];
    var latch = subs.length;

    function doSub(i) {
        if (i === subs.length) {
            return cont();
        }
        var sub = subs[i];
        sub.setEncoding('utf8');
        sub.on('data', function(msg) {
            assert.equal('multi', msg);
            latch--;
            if (latch === 0) done();
        });
        sub.connect('testMultiSub', function() { doSub(i+1); });
    }

    function cont() {
        var pub = CTX.socket('PUB');
        pub.connect('testMultiSub', function() {
            pub.write('multi');
        });
    }

    doSub(0);
});

suite.onePull = testWithContext(function(done) {
    // It's very difficult to test that something didn't happen;
    // however we can serialise sends with recvs to make sure the
    // whole moves in single steps.
    var pulls = [CTX.socket('PULL'), CTX.socket('PULL'), CTX.socket('PULL')];
    var expect = {'start': 'first',
                  'first': 'second',
                  'second': 'third',
                  'third': 'end'};
    var state = 'start';

    function doPull(i) {
        if (i === pulls.length) {
            return cont();
        }
        var pull = pulls[i];
        pull.setEncoding('utf8');
        pull.on('data', function(msg) {
            assert.equal(expect[state], msg);
            // make sure we can't make this transition again
            delete expect[state];
            state = msg;
            if (state === 'end')
                done();
            else
                send();
        });
        pull.connect('testMultiPull', function() { doPull(i+1); });
    }

    var push = CTX.socket('PUSH');

    function send() {
        push.write(expect[state]);
    }

    function cont() {
        push.connect('testMultiPull', function() {
            send();
        });
    }

    doPull(0);
});
