/* Require dependencies */
const fs = require( 'fs' );
const ftp = require( 'ftp' );
const schedule = require( 'node-schedule' );
const csv = require( 'csv' );
const express = require( 'express' );
const cors = require( 'cors' );

/* Create an in memory array to store bsb data and providers data */
let bsbData = [];
let providers = {};

/* Load up the config */
const config = require( './config.json' );

/* Load up the providers file */
loadProviders();

/* Complete an initial sync */
checkSync();

/* Setup a recurring check every 6 hours */
schedule.scheduleJob( `0 */${config.syncInterval} * * *`, () => {
  checkSync();
});

/* Setup a HTTP server to serve up results */
startHTTP();

function checkSync() {
  /* Check whether or not we have synced previously */
  console.log( 'Checking for existing data files' );
  fs.readFile( `${config.storagePath}/download-info.txt`, ( err, data ) => {
    data = ( data ) ? data.toString() : null;
    fetchList( data );
  });
}

function fetchList( lastFetchedName ) {
  /* Create a new ftp client */
  const client = new ftp();
  /* Create an event listener that listens for when the connection is created */
  client.on( 'ready' , () => {
    console.log( 'FTP connection ready' );
    /* List all of the files */
    client.list(( err, files ) => {
      if ( err ) {
        console.error( err );
        return;
      }

      /* Filter the list of the files to contain only those that are full listings */
      files = files.filter( f => f.name.indexOf( 'BSBDirectory' ) > -1 && f.name.endsWith( '.csv' ));

      /* Sort the list so that the latest one is at the top */
      files.sort(( a, b ) => b.date - a.date );

      /* Retrieve the latest file entry */
      const latestFile = files[0].name;

      /* Check whether we already have this file fetched */
      if ( latestFile != lastFetchedName ) {
        console.log( `Downloading ${latestFile}` );
        /* Download the file */
        client.get( latestFile, ( err, file ) => {
          if ( err ) {
            console.error( err );
            return;
          }

          /* Write it to the storage directory */
          const output = fs.createWriteStream( `${config.storagePath}/data.csv` );
          file.pipe( output );

          /* Listen for when it is done */
          file.on( 'end', () => {
            console.log( 'File downloaded successfully' );
            /* Write the file name to the download-info file */
            fs.writeFile( `${config.storagePath}/download-info.txt`, latestFile, () => {
              loadDataFile();
            });
          });
        });
      } else {
        console.log( `Already synced ${latestFile}` );
        loadDataFile();
      }
    });
  });
  /* Connect to the server */
  console.log( 'Attempting connection to FTP server' );
  client.connect({ host: config.ftp.host });
}

function loadDataFile() {
  /* Read the data file from disk */
  console.log( 'Reading saved data file' );
  fs.readFile( `${config.storagePath}/data.csv`, ( err, data ) => {
    if ( err ) {
      console.error( err );
      return;
    }

    csv.parse( data, ( err, data ) => {
      data = data.map( e => {
        return {
          bsb: e[0],
          instituteCode: e[1],
          instituteName: providers[e[1]] || 'Unknown Bank',
          name: e[2],
          address: e[3],
          city: e[4],
          state: e[5],
          postcode: e[6],
        };
      });

      bsbData = data;
      console.log( 'Read and parsed stored BSB data' );
    });
  });
}

function loadProviders() {
  /* Read the data file from disk */
  console.log( 'Reading saved providers data file' );
  fs.readFile( `${config.storagePath}/providers.csv`, ( err, data ) => {
    if ( err ) {
      console.error( err );
      return;
    }

    csv.parse( data, ( err, data ) => {
      data.forEach( e => {
        providers[e[0]] = e[1];
      });
      console.log( 'Read and parsed stored providers data' );
    });
  });
}

function startHTTP() {
  const app = express();

  /* Add cors support */
  app.use( cors());

  app.get( '/', ( req, res ) => {
    res.json({ name: 'BSB lookup service', version: process.env.BUILD_NUMBER });
  });

  app.get( '/health', ( req, res ) => {
    /* If we have no bsb records loaded return a 503 */
    if ( bsbData.length === 0 || Object.keys( providers ).length === 0 ) {
      res.status( 503 );
    } else {
      res.status( 200 );
    }

    return res.json({ healthy: bsbData.length != 0 && Object.keys( providers ).length != 0, count: bsbData.length, providerCount: Object.keys( providers ).length });
  });

  app.get( '/bsb', ( req, res ) => {
    res.json( bsbData );
  });

  app.get( '/bsb/:bsb', ( req, res ) => {
    const bsb = req.params.bsb;
    const result = bsbData.find( e => e.bsb === bsb );

    if ( result ) {
      res.json( result );
    } else {
      res.status( 404 );
      res.json({ error: 'BSB not found' });
    }
  });

  app.listen( config.port, () => {
    console.log( `BSB lookup service listening on port ${config.port}!` );
  });
}
