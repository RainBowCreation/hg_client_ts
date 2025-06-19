// This is the updated main application component for the React client.
// CORRECTED: Uses the DbConnection builder pattern from the auto-generated bindings.

import React, { useEffect, useState } from 'react';
// CORRECTED: Identity is imported from the main SDK, but DbConnection comes from bindings.
import { Identity } from '@clockworklabs/spacetimedb-sdk';
import './App.css';
// CORRECTED: Importing DbConnection and other necessary types from the generated bindings file.
import { DbConnection, SecretHistory, ServerHashLog } from './module_bindings';

// --- WASM Setup ---

// Import the functions directly from the wasm-bindgen generated package.
import init, { hash_random_wasm } from '../pkg';

// --- React Component ---

function App() {
  // State for the SpacetimeDB connection and client identity
  // CORRECTED: Changed state variable to `conn` to match the DbConnection pattern.
  const [conn, setConn] = useState<DbConnection | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [connected, setConnected] = useState<boolean>(false);

  // State to track if our WASM module has been initialized
  const [wasmInitialized, setWasmInitialized] = useState<boolean>(false);

  // State for our application data, subscribed from the server
  const [secretHistory, setSecretHistory] = useState<SecretHistory[]>([]);
  const [serverHashLog, setServerHashLog] = useState<ServerHashLog[]>([]);

  // State to display the results of our client-side actions
  const [lastClientHash, setLastClientHash] = useState<string>("");

  // --- Effect for Initializing WASM and SpacetimeDB connection ---
  useEffect(() => {
    // Initialize our WASM module from the `hg_shared_bindgen` crate.
    async function initWasm() {
      try {
        await init(); // This loads and initializes the WASM module.
        setWasmInitialized(true);
        console.log("WASM module initialized successfully.");
      } catch (err) {
        console.error("Error initializing WASM module:", err);
      }
    }
    initWasm();

    const subscribeToQueries = (conn: DbConnection, queries: string[]) => {
      conn
        ?.subscriptionBuilder()
        .onApplied(() => {
          console.log('SDK client cache initialized.');
        })
        .subscribe(queries);
    };

    // --- Connection Logic using the Builder Pattern ---

    const onConnect = (connection: DbConnection, self_identity: Identity, token: string) => {
      setConn(connection);
      setIdentity(self_identity);
      setConnected(true);
      if (token) localStorage.setItem('auth_token', token);
      console.log("Connected to SpacetimeDB!");

      // Subscribe to tables AFTER connection is established.
      subscribeToQueries(connection, [
        "SELECT * FROM secret_history",
        "SELECT * FROM server_hash_log",
      ]);

      // Register table update callbacks on the new connection object.
      registerCallbacks(connection);
    };

    const onDisconnect = () => {
      setConnected(false);
      console.log("Disconnected.");
    };
    
    // Build the connection. The `.build()` method initiates the connection attempt.
    DbConnection.builder()
      .withUri('ws://localhost:3000')
      .withModuleName('hardcore-gacha')
      .withToken(localStorage.getItem('auth_token') || '')
      .onConnect(onConnect)
      .onDisconnect(onDisconnect)
      .build();

  }, []); // This effect runs only once on component mount

  // Function to register all our table update handlers
  const registerCallbacks = (dbConn: DbConnection) => {
      // Callback for when a new secret is inserted into the history
      dbConn.db.secretHistory.onInsert((_ctx, secretRow) => {
        setSecretHistory(prev => {
          const newHistory = [...prev, secretRow];
          // Keep the history sorted by time
          return newHistory.sort((a, b) => Number(a.validFromTimeMicros - b.validFromTimeMicros));
        });
      });

      // Callback for when a new server-side hash is logged
      dbConn.db.serverHashLog.onInsert((_ctx, hashLogRow) => {
        // We only care about hashes requested by our own identity
        if(identity && hashLogRow.requester.isEqual(identity)) {
          console.log("✅ Received our requested hash from the server:", hashLogRow);
          // Add to the front of the array to show the newest first
          setServerHashLog(prev => [hashLogRow, ...prev]);
        }
      });
  };

  // --- Helper function to find the correct secret for a given time ---
  const findSecretForTime = (time_ms: number): string | null => {
    const time_micros = BigInt(time_ms) * 1000n;
    let activeSecret = null;
    for (let i = secretHistory.length - 1; i >= 0; i--) {
      const secret = secretHistory[i];
      if (secret.validFromTimeMicros <= time_micros) {
        activeSecret = secret.value;
        break; 
      }
    }
    return activeSecret;
  };

  // --- Action Handlers ---

  const handleGenerateHashes = () => {
    if (!wasmInitialized || !conn) {
      alert("WASM or DB not ready.");
      return;
    }

    // --- 1. Generate Client-Side Hash ---
    const clientTimeMs = BigInt(Date.now());
    const secretToUse = findSecretForTime(Number(clientTimeMs));

    if (secretToUse) {
      const clientHash = hash_random_wasm(clientTimeMs, secretToUse);
      setLastClientHash(clientHash);
      console.log(`Client-side hash generated: ${clientHash}`);
    } else {
      const msg = "Not enough secret history to generate client hash.";
      setLastClientHash(msg);
      console.warn(msg);
    }

    // --- 2. Request a Server-Side Hash for Comparison ---
    console.log("Requesting a new hash from the server...");
    // CORRECTED: Calling the reducer via the `conn.reducers` object.
    conn.reducers.hashRandomAtServer();
  };

  // --- Render Logic ---

  if (!connected || !wasmInitialized) {
    return <div className="App"><h1>Connecting & Initializing...</h1></div>;
  }

  return (
    <div className="App">
      <h1>SpacetimeDB Synchronized Hashing</h1>
      <p>Identity: <code>{identity?.toHexString()}</code></p>
      
      <div className="action-panel">
        <button onClick={handleGenerateHashes}>Generate Client & Server Hashes</button>
        <h3>Last Client-Side Hash:</h3>
        <p className="hash-display">{lastClientHash || 'N/A'}</p>
      </div>

      <div className="data-display">
        <div className="column">
          <h2>Secret History (from Server)</h2>
          <div className="log-box">
            {secretHistory.slice(-10).reverse().map((secret) => (
              <p key={secret.version.toString()}>
                <b>Time:</b> {new Date(Number(secret.validFromTimeMicros / 1000n)).toLocaleTimeString()}
                <b> Secret:</b> <code>{secret.value.substring(0, 12)}...</code>
              </p>
            ))}
          </div>
        </div>
        <div className="column">
          <h2>Server Hash Log (Your Requests)</h2>
          <div className="log-box">
            {serverHashLog.slice(0, 10).map((log) => (
              <p key={log.requestId.toString()}>
                <b>Time:</b> {new Date(Number(log.timestampMs)).toLocaleTimeString()}
                <b> Hash:</b> <code>{log.hashValue.substring(0, 12)}...</code>
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;