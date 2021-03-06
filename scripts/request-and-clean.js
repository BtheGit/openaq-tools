const _ = require('lodash');
const csv = require('csvtojson');
const fs = require('fs');
const moment = require('moment');
const request = require('request');
const yaml = require('js-yaml');
const { S3 } = require('aws-sdk');
const s3 = new S3();

const baseUrl = 'https://openaq-data.s3.amazonaws.com'
const Flagger = require('openaq-quality-checks/lib/flagger');
const config = yaml.safeLoad(fs.readFileSync('scripts/config.yml', 'utf8'));

const startDate = moment('2016-12-31');
const endDate = moment('2017-12-31');
let currentDate = startDate;
const locationsFilter = ['Shanghai', 'Delhi'];
const bucketName = 'aimeeb-datasets';
const bucketPrefix = 'openaq/pm2.5';

// If you want an exclusive end date (half-open interval)
for (let currentDate = moment(startDate); currentDate.isBefore(endDate); currentDate.add(1, 'days')) {
  const currentDateString = currentDate.format('YYYY-MM-DD');

  request(`${baseUrl}/${currentDateString}.csv`, function (error, response, body) {
    if (error) console.log('error:', error); // Print the error if one occurred
    console.log('statusCode:', response && response.statusCode); // Print the response status code if a response was received
    console.log(`Downloaded data for ${currentDateString}`);
    const csvStr = body;
    let measurements = [];

    csv({checkType: true}).fromString(csvStr)
      .on('json', (jsonObj) => {
        measurements.push(jsonObj);
      })
      .on('done',() => {
        // filter pm2.5
        measurements = measurements.filter((measurement) => {
          return measurement.parameter === 'pm25';
        });

        // remove flagged data
        let flaggedData = measurements;
        Object.values(config).forEach((flagConfig) => {
          const flagger = new Flagger(flagConfig);
          flaggedData = flagger.flag(flaggedData);
        });
        const filteredData = flaggedData.filter(datum => !(datum.flags && datum.flags.length > 0));

        // group by location and write to files
        // /data/<location>/<date>.json
        const groups = _.groupBy(filteredData, 'location');
        const locations = locationsFilter.length > 0 ? locationsFilter : Object.keys(groups);

        locations.forEach((locationName) => {
          const locationData = groups[locationName];
          // FOR S3: const directory = locationName.split(' ').join('_');
          const directory = `./data/dontcommit/${locationName.split(' ').join('_')}`;

          // TODO(aimee): Fix { Error: ENOENT: no such file or directory, mkdir './data/Horst_a/d_Maas-Hoogheide'
          try {
            body = JSON.stringify(locationData, null, 2);
            // FOR S3:
            // const keyName = `${bucketPrefix}/${locationName}/${currentDateString}.json`;
            // params = {Bucket: bucketName, Key: keyName, Body: body};
            // s3.putObject(params, function(err, data) {
            //   if (err) {
            //     console.log(err)
            //   } else {
            //     console.log(`Successfully uploaded data to ${keyName}.json`);
            //   }
            // });

            if (!fs.existsSync(directory)) fs.mkdirSync(directory);
            fs.writeFileSync(`${directory}/${currentDateString}.json`, body, 'utf-8');
          } catch (e) {
            console.log(e);
          }
        });
      });
  });
};
