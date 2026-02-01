#!/usr/bin/env python3
"""
Test WebSocket Request-Response Pattern
========================================

Quick test to verify the WebSocket architecture works correctly.
"""

import asyncio
import json
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from websockets import connect


async def test_websocket_requests():
    """Test WebSocket request-response pattern."""
    
    uri = "ws://localhost:8000/ws"
    
    print(f"🔌 Connecting to {uri}...")
    
    async with connect(uri) as websocket:
        print("✅ Connected")
        
        # Test 1: Hello handshake
        print("\n📨 Test 1: Hello handshake")
        hello_msg = {
            "v": 1,
            "type": "hello",
            "id": "test-hello",
            "ts": "2024-02-01T10:00:00.000Z",
            "data": {"clientId": "test-client"}
        }
        await websocket.send(json.dumps(hello_msg))
        response = await websocket.recv()
        data = json.loads(response)
        assert data["type"] == "ack", f"Expected ack, got {data['type']}"
        print(f"✅ Received: {data}")
        
        # Test 2: Get settings via request
        print("\n📨 Test 2: Get settings (request-response)")
        request_msg = {
            "v": 1,
            "type": "request",
            "id": "test-get-settings",
            "ts": "2024-02-01T10:00:00.000Z",
            "method": "settings.get",
            "params": {}
        }
        await websocket.send(json.dumps(request_msg))
        response = await websocket.recv()
        data = json.loads(response)
        assert data["type"] == "response", f"Expected response, got {data['type']}"
        assert data["id"] == "test-get-settings"
        assert "data" in data
        print(f"✅ Received settings with {len(data['data'])} keys")
        print(f"   Theme: {data['data'].get('theme')}")
        print(f"   Language: {data['data'].get('language')}")
        
        # Test 3: Get profiles via request
        print("\n📨 Test 3: Get profiles (request-response)")
        request_msg = {
            "v": 1,
            "type": "request",
            "id": "test-get-profiles",
            "ts": "2024-02-01T10:00:00.000Z",
            "method": "profiles.get",
            "params": {}
        }
        await websocket.send(json.dumps(request_msg))
        response = await websocket.recv()
        data = json.loads(response)
        assert data["type"] == "response"
        assert data["id"] == "test-get-profiles"
        assert "data" in data
        print(f"✅ Received {len(data['data'].get('profiles', []))} profiles")
        
        # Test 4: Invalid method (error handling)
        print("\n📨 Test 4: Invalid method (error handling)")
        request_msg = {
            "v": 1,
            "type": "request",
            "id": "test-invalid",
            "ts": "2024-02-01T10:00:00.000Z",
            "method": "invalid.method",
            "params": {}
        }
        await websocket.send(json.dumps(request_msg))
        response = await websocket.recv()
        data = json.loads(response)
        assert data["type"] == "response"
        assert "message" in data or "error" in data
        print(f"✅ Received error response: {data.get('message')}")
        
        # Test 5: Ping-pong (heartbeat)
        print("\n📨 Test 5: Heartbeat (ping-pong)")
        ping_msg = {
            "v": 1,
            "type": "ping",
            "ts": "2024-02-01T10:00:00.000Z"
        }
        await websocket.send(json.dumps(ping_msg))
        response = await websocket.recv()
        data = json.loads(response)
        assert data["type"] == "pong"
        print(f"✅ Received pong")
        
        print("\n🎉 All tests passed!")


if __name__ == "__main__":
    print("=" * 60)
    print("WebSocket Request-Response Pattern Test")
    print("=" * 60)
    print("\nMake sure the backend is running:")
    print("  cd apps/backend && python -m web.main\n")
    
    try:
        asyncio.run(test_websocket_requests())
    except ConnectionRefusedError:
        print("\n❌ Connection refused. Is the backend running?")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
