/*
 * grunt-contrib-jasmine
 * http://gruntjs.com/
 *
 * Licensed under the MIT license.
 */

'use strict';

module.exports = function(grunt) {
    // node api
    var fs   = require('fs'),
        path = require('path'),
        resultsArr = [];

    // npm lib
    var phantomjs = require('grunt-lib-phantomjs').init(grunt);
    var childProcess = require('child_process');
    var u = grunt.util,
        l = grunt.log;

    var fetchOption = function (namespace, option, options, defaults) {
        if (Object.prototype.hasOwnProperty.call(options, namespace) && Object.prototype.hasOwnProperty.call(options[namespace], option)) {
            return options[namespace][option]
        } else if (Object.prototype.hasOwnProperty.call(defaults, namespace) && Object.prototype.hasOwnProperty.call(defaults[namespace], option)) {
            return defaults[namespace][option];
        } else {
            return undefined;
        }
    };

    var _checkResult = function(msg, res, threshold, value) {
        var data = [msg, value.toString()],
            status = '[PASS]'.green.bold;

        if ( ! res) {
            status =  '[FAIL]'.red.bold + ' threshold is ' + threshold;
        }

        data.push(status);
        return l.table([20, 15, 55], data);
    };

    grunt.registerMultiTask('yslow', 'Run Yslow headlessly through PhantomJS.', function() {
        var urls = this.data.files;
        var baseUrl = (this.data.baseUrl || '');
        var testCount = urls.length;
        var testRun = 0;
        var thresholdArr = [];
        var options = this.options({});
        var CI = (options.ci || false);

        var temp = testCount;

        while (temp--) {
            thresholdArr.push({
                thresholdWeight: null,
                thresholdRequests: null,
                thresholdScore: null,
                thresholdSpeed: null
            });
        }

        l.writeln('Testing ' + testCount + ' URLs, this might take a few moments...');

        // This task is asynchronous.
        var done = this.async();

        var createPhantomRunner = function(i) {
            var url = [baseUrl, urls[i].src[0]].join('');
            var data = urls[i];

            // setup thresholds
            thresholdArr[i].thresholdWeight = fetchOption('thresholds', 'weight', data, options);
            thresholdArr[i].thresholdRequests = fetchOption('thresholds', 'requests', data, options);
            thresholdArr[i].thresholdScore = fetchOption('thresholds', 'score', data, options);
            thresholdArr[i].thresholdSpeed = fetchOption('thresholds', 'speed', data, options);

            // get phantomjs binary, or depend on a global(/path) install if it can't be found
            var phantom, cmd = [];

            try {
                // Look up first
                phantom = require('phantomjs');
                if (phantom['path']) {
                  cmd.push(phantom['path']);
                } else {
                  throw 'Phantomjs path from required module is empty';
                }
            } catch (e) {
                l.error(e);
                try {
                    // Look down if that fails
                    phantom = require(path.join(__dirname, '..', '..', '..', 'node_modules', 'phantomjs'));
                    if (phantom['path']) {
                      cmd.push(phantom.path);
                    } else {
                      throw 'Phantomjs path from included dependency is empty';
                    }
                } catch (e) {
                    l.error(e);
                    // This should never happen since 'grunt-lib-phantomjs' would have enforced one of the above
                    cmd.push('phantomjs');
                }
            }

            // creates a seperate scope for child variable
            cmd.push('--ignore-ssl-errors=true');
            cmd.push('node_modules/grunt-yslow/tasks/lib/yslow.js');

            if (CI) {
                cmd.push('--format ' + (CI.format || 'junit'));
                cmd.push('--info grade');
            } else {
                cmd.push('--info basic');
            }

            // Add any custom parameters
            var userAgent = fetchOption('yslowOptions', 'userAgent', data, options);
            var cdns = fetchOption('yslowOptions', 'cdns', data, options);
            var viewport = fetchOption('yslowOptions', 'viewport', data, options);
            var headers = fetchOption('yslowOptions', 'headers', data, options);

            if (userAgent) { cmd.push('--ua "' + userAgent +'"'); }
            if (cdns) { cmd.push('--cdns "' + cdns.join(',') +'"'); }
            if (viewport) { cmd.push('--viewport "' + viewport + '"'); }
            if (headers) { cmd.push('--headers "' + JSON.stringify(headers) + '"'); }

            if (CI) {
                cmd.push('--thrashold=' + parseInt(thresholdArr[i].thresholdScore));
            }

            cmd.push('"' + url + '"');

            var execCallback = function (err, stdout, stderr) {
                var output = [],
                    results;

                try {
                    results = JSON.parse(stdout);
                } catch (error) {
                    l.error(stdout);
                    done(false);
                }

                output.push(_checkResult('Requests', thresholdArr[i].thresholdRequests >= results.r, thresholdArr[i].thresholdRequests + ' requests', results.r));
                output.push(_checkResult('YSlow score', thresholdArr[i].thresholdScore <= results.o, thresholdArr[i].thresholdScore, results.o + '/100'));
                output.push(_checkResult('Page load time', thresholdArr[i].thresholdSpeed >= results.lt, thresholdArr[i].thresholdSpeed + 'ms', results.lt + 'ms'));
                output.push(_checkResult('Page size', thresholdArr[i].thresholdWeight >= (results.w / 1000), thresholdArr[i].thresholdWeight + 'Kb', (results.w / 1000) + 'Kb'));

                var header = grunt.template.process('Test <%= n %>: <%= url %>', {data: {n: (i + 1), url: urls[i].src}}),
                    hasErrors = output.map(function(item) {
                            return l.uncolor(item).toString().match(/\[FAIL]/g);
                        }).filter(function(item) {
                            return item;
                        }).length > 0;

                if (hasErrors) {
                    l.subhead(header);
                    l.errorlns(output.join('\n'));

                    grunt.fail.warn('Threshold limit exhausted while testing ' + urls[i].src + '.');
                } else {
                    l.subhead(header);
                    l.oklns(output.join('\n'));
                }

                if (++testRun >= testCount) {
                    done();
                }
            };

            if (CI) {
                execCallback = function (err, stdout, stderr) {
                    // if (err) {
                    //     grunt.fail.warn(err);
                    //     done(false);
                    // }

                    grunt.file.write(path.join(CI.reportPath, 'report' + i + '.xml'), stdout);
                    l.ok('Report for ' + urls[i].src + ' collected\n');

                    if (++testRun >= testCount) {
                        done();
                    }
                };
            }

            var child = childProcess.exec(cmd.join(' '), [], execCallback);
        };

        for (var i = 0, len = urls.length; i < len; i++) {
            createPhantomRunner(i);
        }
    });
};
