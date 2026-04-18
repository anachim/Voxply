// App.tsx — Root component. Like App.razor in Blazor.
//
// In Blazor:
//   @code {
//     private string greeting = "Hello";
//   }
//   <h1>@greeting</h1>
//
// In React:
//   function App() {
//     const [greeting] = useState("Hello");
//     return <h1>{greeting}</h1>;
//   }
//
// Key differences from Blazor:
// - Components are functions, not classes
// - State uses useState() hook instead of @code { } fields
// - JSX uses {expression} instead of @expression
// - No two-way binding — you handle onChange events explicitly

import { useState } from "react";

function App() {
  const [connected, setConnected] = useState(false);
  const [hubUrl, setHubUrl] = useState("http://localhost:3000");

  return (
    <div className="app">
      {!connected ? (
        <div className="connect-screen">
          <h1>Voxply</h1>
          <p>Decentralized voice chat + community platform</p>
          <div className="connect-form">
            <input
              type="text"
              value={hubUrl}
              onChange={(e) => setHubUrl(e.target.value)}
              placeholder="Hub URL"
            />
            <button onClick={() => setConnected(true)}>Connect</button>
          </div>
        </div>
      ) : (
        <div className="main-layout">
          <div className="sidebar">
            <h3>Channels</h3>
            <p>Connected to {hubUrl}</p>
          </div>
          <div className="content">
            <h3>Messages</h3>
            <p>Select a channel to start chatting</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
