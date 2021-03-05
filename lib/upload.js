var AWS = require('aws-sdk');
var glob = require('glob');
var path = require('path');
var fs = require('fs');
var _ = require('lodash');
var async = require('async');
var mimeTypes = require('mime-types');
var shelljs = require('shelljs');

function getEnvVariable(name) {
  try {
    return process.env[name] || fs.readFileSync(path.join(process.env.ENV_DIR, name), {encoding: 'utf8'});
  } catch(error) {
    console.error('Could not find: ' + name);
  }
}

try {

  AWS.config.maxRetries = 10;

  AWS.config.accessKeyId = getEnvVariable('AWS_ACCESS_KEY_ID');
  AWS.config.secretAccessKey = getEnvVariable('AWS_SECRET_ACCESS_KEY');
  AWS.config.region = getEnvVariable('AWS_DEFAULT_REGION');

  // bucket where static assets are uploaded to
  var AWS_STATIC_BUCKET_NAME = getEnvVariable('AWS_STATIC_BUCKET_NAME');
  // the source directory of static assets
  var AWS_STATIC_SOURCE_DIRECTORY = getEnvVariable('AWS_STATIC_SOURCE_DIRECTORY');

} catch(error) {
  console.error('Static Uploader is not configured for this deploy');
  console.error(error);
  console.error('Exiting without error');
  process.exit(0);
}

var keys = Object.keys(process.env);
for(var i=0;i<keys.length;i++) {
  console.log("KEY: " + keys[i]);
}
var BUILD_DIR = process.env.BUILD_DIR;

// location of public assets in the heroku build environment
var PUBLIC_ASSETS_SOURCE_DIRECTORY = path.join(BUILD_DIR, AWS_STATIC_SOURCE_DIRECTORY);

var HEROKU_APP_NAME = getEnvVariable('HEROKU_APP_NAME');

if (HEROKU_APP_NAME !== undefined) {
  try {
    fs.renameSync(
      PUBLIC_ASSETS_SOURCE_DIRECTORY + '/asset-manifest.json',
      PUBLIC_ASSETS_SOURCE_DIRECTORY + '/' + HEROKU_APP_NAME + '.json'
    });  
  } catch(err) {
    console.error('ERROR: ' + err);
  }
};

glob(PUBLIC_ASSETS_SOURCE_DIRECTORY + '/**/*.*', {}, function(error, files) {
    if (error || !files) {
      return process.exit(1);
    }

    console.log('Files to Upload:', files.length);
    console.time('Upload Complete In');

    var s3 = new AWS.S3();
    async.eachLimit(files, 16, function(file, callback) {
        var stat = fs.statSync(file);
        if (!stat.isFile()) {
          console.log('Not a file', file);
          return callback(null);
        }

        var contentType = mimeTypes.lookup(path.extname(file)) || null;
        if (!_.isString(contentType)) {
          console.warn('Unknown ContentType:', contentType, file);
          contentType = 'application/octet-stream';
        }

        console.log('Uploading File: ' + file);

        s3.upload({
          Key: file.replace(PUBLIC_ASSETS_SOURCE_DIRECTORY + '/', ''),
          Body: fs.createReadStream(file),
          Bucket: AWS_STATIC_BUCKET_NAME,
          ContentType: contentType
        }, callback);

      },
      function onUploadComplete(error) {
        console.timeEnd('Upload Complete In');

        if (error) {
          console.error('Static Uploader failed to upload to S3');
          console.error(error);
          console.error('Exiting without error');
          process.exit(0);
        }

        var profiled = process.env.BUILD_DIR + '/.profile.d';
        fs.writeFileSync(
          path.join(profiled, '00-upload-static-files-to-s3-export-env.sh'),
          'echo EXPORTING STATIC ENV VARIABLES\n' +
          'export STATIC_SERVER=${STATIC_SERVER:-' + AWS_STATIC_BUCKET_NAME + '.s3.amazonaws.com' + '}\n',
          {encoding: 'utf8'}
        );

        process.exit(0);
      });
  }
);
