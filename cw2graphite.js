var config = require('./lib/readConfig.js').readCmdOptions();

// Now using the official Amazon Web Services SDK for Javascript
var AWS = require("aws-sdk");

// We'll use the Cloudwatch API
var cloudwatch = new AWS.CloudWatch(config.awsCredentials);

// get the graphite prefix from the metrics config or use cloudwatch as default
var graphitePrefix = config.metricsConfig.carbonNameSpacePrefix || 'cloudwatch';

// use legacy format, defaulting to false
var useLegacyFormat = config.metricsConfig.legacyFormat;

// pulling all of lodash for _.sortBy(), does it matter? Do we even need to sort?
var _ = require('lodash');

// TODO: do we need both those libraries, do we need any?
var dateFormat = require('dateformat');
require('./lib/date');

// number of minutes of recent data to query
var interval = 3;

// Between now and 11 minutes ago
var now = new Date();
var then = (interval).minutes().ago();
var end_time = dateFormat(now, "isoUtcDateTime");
var start_time = dateFormat(then, "isoUtcDateTime");

// We used to use this when looking at Billing metrics
// if ( metric.Namespace.match(/Billing/) ) {
//     then.setHours(then.getHours() - 30)
// }
// if ( metric.Namespace.match(/Billing/) ) {
//     options["Period"] = '28800'
// }

var metrics = config.metricsConfig.metrics;

getAllELBNames(getELBMetrics);
getAllRDSInstanceNames(getRDSMetrics);
getAllElasticCacheNames(getElasticCacheMetrics);

for (var index in metrics) {
    printMetric(metrics[index], start_time, end_time);
}

function printMetric(metric, get_start_time, get_end_time) {

    var getMetricStatistics_param = metric;

    getMetricStatistics_param.StartTime = get_start_time;
    getMetricStatistics_param.EndTime = get_end_time;

    cloudwatch.getMetricStatistics(getMetricStatistics_param, function (err, data) {
        if (err) {
            console.error(err, err.stack); // an error occurred
            console.error("on:\n" + JSON.stringify(getMetricStatistics_param, null, 2));
        }
        else {
            formatter = useLegacyFormat ? legacyFormat : newFormat;
            console.log( formatter(metric, data).join("\n"));
        }
    });
}

// Takes the orig query and the response and formats the response as an array of strings
function newFormat(query, data) {
    var dimension_prefix = _.map(query.Dimensions, function(dim) {
        return dim.Name + '_' + dim.Value;
    }).join('.');

    return _.map(data.Datapoints, function(point) {
        var name = query.Namespace.replace("/", ".");
        name += '.' + dimension_prefix;
        name += '.' + query.MetricName;
        var value = point[query['Statistics']];
        var time = parseInt(new Date(point.Timestamp).getTime() / 1000.0);
        return name + ' ' + value + ' ' + time;
    });
}

// Takes the orig query and the response and formats the response as an array of strings
// according to old style of cloudwatch2graphite.
function legacyFormat(query, data) {

    // the legacy format is to only use the dimension Values in the prefix
    var dimension_prefix = _.map(query.Dimensions, function(dim) {
        return dim.Value;
    }).join('.');

    return _.map(data.Datapoints, function(point) {
        var name = query.Namespace.replace("/", ".");
        name += '.' + dimension_prefix;
        name += '.' + query.MetricName;
        name += '.' + query['Statistics'];
        name += '.' + query['Unit'];
        var value = point[query['Statistics']];
        var time = parseInt(new Date(point.Timestamp).getTime() / 1000.0);
        return graphitePrefix + '.' + name.toLowerCase() + ' ' + value + ' ' + time;
    });
}

// returns a hash with all details needed for an cloudwatch metrics query
function buildMetricQuery(namespace, name, unit, statistics, dimensions, period) {
    return {
        'Namespace': namespace,
        'MetricName': name,
        'Unit' : unit,
        'Statistics': [statistics],
        'Dimensions' : dimensions,
        'Period' : period || 60,
    }
}

// executes callback with array of names of all ELBs
function getAllELBNames(callback) {
    var elb = new AWS.ELB(config.awsCredentials);
    elb.describeLoadBalancers({}, function(err, data) {
        if (err) {
            console.log(err);
            callback([]);
        }
        callback(_.pluck(data.LoadBalancerDescriptions, 'LoadBalancerName'));
    });
}

// takes array of ELB names and gets a variety metrics
function getELBMetrics(elbs) {
    for (index in elbs) {
        var elb = elbs[index];
        var dimensions = [ { "Name" : 'LoadBalancerName', "Value" : elb} ];
        printMetric(buildMetricQuery('AWS/ELB', 'Latency', 'Seconds', 'Average', dimensions), start_time, end_time);
        printMetric(buildMetricQuery('AWS/ELB', 'HealthyHostCount', 'Count', 'Average', dimensions), start_time, end_time);
        printMetric(buildMetricQuery('AWS/ELB', 'UnHealthyHostCount', 'Count', 'Average', dimensions), start_time, end_time);
        printMetric(buildMetricQuery('AWS/ELB', 'HTTPCode_Backend_2XX', 'Count', 'Sum', dimensions), start_time, end_time);
        printMetric(buildMetricQuery('AWS/ELB', 'HTTPCode_Backend_3XX', 'Count', 'Sum', dimensions), start_time, end_time);
        printMetric(buildMetricQuery('AWS/ELB', 'HTTPCode_Backend_4XX', 'Count', 'Sum', dimensions), start_time, end_time);
        printMetric(buildMetricQuery('AWS/ELB', 'HTTPCode_Backend_5XX', 'Count', 'Sum', dimensions), start_time, end_time);
        printMetric(buildMetricQuery('AWS/ELB', 'HTTPCode_ELB_4XX', 'Count', 'Sum', dimensions), start_time, end_time);
        printMetric(buildMetricQuery('AWS/ELB', 'HTTPCode_ELB_5XX', 'Count', 'Sum', dimensions), start_time, end_time);
    }
}

// executes callback with array of names of all RDS db instances
function getAllRDSInstanceNames(callback) {
    var rds = new AWS.RDS(config.awsCredentials);
    rds.describeDBInstances({}, function(err, data) {
        if (err) {
            console.log(err);
            callback([]);
        }
        callback(_.pluck(data.DBInstances, 'DBInstanceIdentifier'));
    });
}

// takes array of RDS db instance names and gets a variety metrics
function getRDSMetrics(instances) {
    for (index in instances) {
        var instance = instances[index];
        var dimensions = [ { "Name" : 'DBInstanceIdentifier', "Value" : instance} ];
        printMetric(buildMetricQuery('AWS/RDS', 'CPUUtilization', 'Percent', 'Average', dimensions), start_time, end_time);
        printMetric(buildMetricQuery('AWS/RDS', 'DatabaseConnections', 'Count', 'Average', dimensions), start_time, end_time);
    }
}

// executes callback with array of hashes of that include ElastiCache CacheClusterId and CacheNodeId
function getAllElasticCacheNames(callback) {
    var ec = new AWS.ElastiCache(config.awsCredentials);
    ec.describeCacheClusters({ ShowCacheNodeInfo: true}, function(err, data) {
        if (err) {
            console.log(err);
            callback([]);
        }
        var nodes = _.map(data.CacheClusters, function(value, key) {
            return [{'Name':'CacheClusterId', 'Value':value.CacheClusterId},
                    {'Name':'CacheNodeId', 'Value':value.CacheNodes[0].CacheNodeId}];
        });
        callback(nodes);
    });
}

// takes array of hashes of ElastiCache CacheClusterId and CacheNodeId and gets a variety metrics
function getElasticCacheMetrics(nodes) {
    for (index in nodes) {
        var node = nodes[index];
        printMetric(buildMetricQuery('AWS/ElastiCache', 'CPUUtilization', 'Percent', 'Average', node), start_time, end_time);
      byte_metrics = ['UnusedMemory', 'FreeableMemory', 'NetworkBytesIn', 'NetworkBytesOut'];
        for (index in byte_metrics) {
            printMetric(buildMetricQuery('AWS/ElastiCache', byte_metrics[index], 'Bytes', 'Average', node), start_time, end_time);
        }
      count_metrics = ['CurrConnections', 'CurrItems', 'Evictions', 'Reclaimed', 'GetHits', 'CacheHits',
                       'GetMisses', 'CacheMisses', 'GetTypeCmds', 'SetTypeCmds', 'CmdGet', 'CmdSet', 'DeleteHits', 'DeleteMisses', 'NewItems', 'NewConnections' ];
        for (index in count_metrics) {
            printMetric(buildMetricQuery('AWS/ElastiCache', count_metrics[index], 'Count', 'Average', node), start_time, end_time);
        }
    }
}
