import { ServerWebSocket } from 'bun'

/**
 * Helper function to extract username from the request
 * @param req - The HTTP request
 * @returns The username from the request or a default value
 */
function getUsernameFromReq(req: Request): string {
    const url = new URL(req.url)
    return url.searchParams.get('username') || 'Anonymous'
}

// Define the data type for our WebSocket connections
interface WebSocketData {
    username: string
    rooms: Set<string> // Set of room names the user has joined
}

/**
 * Helper function to join a room
 * @param ws - The WebSocket connection
 * @param roomName - The name of the room to join
 */
function joinRoom(ws: ServerWebSocket<WebSocketData>, roomName: string): void {
    // Subscribe the client to the room
    ws.subscribe(roomName)

    // Add the room to the client's joined rooms
    ws.data.rooms.add(roomName)

    console.log(`User ${ws.data.username} joined room: ${roomName}`)

    // Notify the user they've joined the room
    ws.send(`You have joined room: ${roomName}`)

    // Notify other room members
    server.publish(roomName, `${ws.data.username} has joined the room`)
}

/**
 * Helper function to leave a room
 */
function leaveRoom(ws: ServerWebSocket<WebSocketData>, roomName: string): void {
    // Check if the user is in the room
    if (!ws.data.rooms.has(roomName)) {
        ws.send(`You are not in room ${roomName}`)
        return
    }

    // Unsubscribe the client from the room
    ws.unsubscribe(roomName)

    // Remove the room from the client's joined rooms
    ws.data.rooms.delete(roomName)

    console.log(`User ${ws.data.username} left room: ${roomName}`)

    // Notify the user they've left the room
    ws.send(`You have left room: ${roomName}`)

    // Notify other room members
    server.publish(roomName, `${ws.data.username} has left the room`)
}

// Create a simple WebSocket server without NATS subscription
// @ts-ignore
const server = Bun.serve<WebSocketData>({
    fetch(req, server) {
        const url = new URL(req.url)

        // Handle WebSocket upgrade requests at the /chat endpoint
        if (url.pathname === '/chat') {
            console.log(`WebSocket upgrade request received`)
            const username = getUsernameFromReq(req)
            const success = server.upgrade(req, {
                data: {
                    username,
                    rooms: new Set() // Initialize empty set of rooms
                }
            })

            return success
                ? undefined
                : new Response('WebSocket upgrade error', { status: 400 })
        }

        // Handle other HTTP requests
        return new Response('Simple WebSocket Server', { status: 200 })
    },

    websocket: {
        // Called when a WebSocket connection is opened
        open(ws) {
            console.log(`User ${ws.data.username} connected`)
            // Send a welcome message directly to this client
            ws.send(`Welcome, ${ws.data.username}!`)
            ws.send(`Available commands:
- /join [room] - Join a room
- /leave [room] - Leave a room
- /room [room] [message] - Send a message to a room
- /rooms - List all available rooms
- /myrooms - List rooms you've joined
- Any other message will be echoed back to you`)
        },

        // Called when a message is received from a client
        message(ws, message) {
            const messageStr = message.toString()
            console.log(`Message from ${ws.data.username}: ${messageStr}`)

            // Check if the message is a command
            if (messageStr.startsWith('/')) {
                const [command, ...args] = messageStr.slice(1).split(' ')

                switch (command.toLowerCase()) {
                    case 'join': {
                        const roomName = args[0]
                        if (!roomName) {
                            ws.send('Please specify a room name: /join [room]')
                            return
                        }
                        joinRoom(ws, roomName)
                        return
                    }

                    case 'leave': {
                        const roomName = args[0]
                        if (!roomName) {
                            ws.send('Please specify a room name: /leave [room]')
                            return
                        }
                        leaveRoom(ws, roomName)
                        return
                    }

                    case 'room': {
                        const roomName = args[0]
                        const roomMessage = args.slice(1).join(' ')

                        if (!roomName || !roomMessage) {
                            ws.send(
                                'Please specify a room name and message: /room [room] [message]'
                            )
                            return
                        }

                        console.log(`Available rooms : ${ws.data.rooms}`)

                        // Check if the user is in the room
                        if (!ws.data.rooms.has(roomName)) {
                            ws.send(
                                `You are not in room ${roomName}. Join it first with /join ${roomName}`
                            )
                            return
                        }

                        // Broadcast the message to the room
                        const formattedMessage = `[${roomName}] ${ws.data.username}: ${roomMessage}`
                        server.publish(roomName, formattedMessage)
                        return
                    }

                    case 'rooms': {
                        // Since we can't directly get a list of all rooms with Bun's API,
                        // we'll just inform the user to try joining specific rooms
                        ws.send('To join a room, use: /join [room]')
                        return
                    }

                    case 'myrooms': {
                        // List rooms the user has joined
                        if (ws.data.rooms.size === 0) {
                            ws.send(
                                'You have not joined any rooms. Join one with /join [room]'
                            )
                            return
                        }

                        const roomList = Array.from(ws.data.rooms).join('\n')
                        ws.send(`Your rooms:\n${roomList}`)
                        return
                    }

                    default:
                        ws.send(
                            `Unknown command: ${command}. Available commands: /join, /leave, /room, /rooms, /myrooms`
                        )
                        return
                }
            }

            // If not a command, echo the message back to the sender with their username
            const response = `${ws.data.username}: ${messageStr}`
            ws.send(response)
        },

        // Called when a WebSocket connection is closed
        close(ws) {
            console.log(`User ${ws.data.username} disconnected`)
            // Leave all rooms the user has joined
            for (const roomName of ws.data.rooms) {
                // Notify other room members
                server.publish(
                    roomName,
                    `${ws.data.username} has left the room (disconnected)`
                )

                // Unsubscribe from the room
                ws.unsubscribe(roomName)
            }

            // Clear the user's rooms
            ws.data.rooms.clear()
        }
    }
})

console.log(
    `Simple WebSocket server listening on ${server.hostname}:${server.port}`
)

export { server }
