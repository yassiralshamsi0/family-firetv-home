package com.glasshome.firetv;

import android.content.res.AssetManager;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

/*
 * The phone remote: a small web server on the home Wi-Fi (port 8090). It serves
 * the remote page (assets/remote/index.html) and the screen's own files, and
 * answers the page's /api calls through the Actions it is given. Every /api
 * call carries the 4-digit code shown on the TV, and only addresses on the
 * home network are answered.
 */
class RemoteServer extends Thread {
    static final int PORT = 8090;

    interface Actions {
        String state(boolean withDock);          // JSON for /api/state (?lite skips the icons)
        boolean launch(String pkg);
        void radio();
        boolean key(String name);
        void home();
        void volume(String how);
    }

    private final AssetManager assets;
    private final String pin;
    private final Actions actions;
    private ServerSocket server;

    RemoteServer(AssetManager assets, String pin, Actions actions) {
        super("remote");
        this.assets = assets;
        this.pin = pin;
        this.actions = actions;
        setDaemon(true);
    }

    void close() {
        try { if (server != null) server.close(); } catch (IOException e) { /* closing anyway */ }
    }

    @Override
    public void run() {
        try {
            server = new ServerSocket(PORT);
            while (!server.isClosed()) {
                final Socket s = server.accept();
                new Thread(new Runnable() {
                    @Override
                    public void run() { serve(s); }
                }).start();
            }
        } catch (IOException e) {
            // closed, or the port is taken: no remote this time
        }
    }

    private void serve(Socket s) {
        try {
            s.setSoTimeout(10000);
            InetAddress from = s.getInetAddress();
            if (!from.isSiteLocalAddress() && !from.isLoopbackAddress()) return;
            BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8));
            String line = in.readLine();
            if (line == null) return;
            String[] parts = line.split(" ");
            if (parts.length < 2) return;
            while ((line = in.readLine()) != null && !line.isEmpty()) { /* headers are not needed */ }
            String method = parts[0];
            String target = parts[1];
            int q = target.indexOf('?');
            String path = q < 0 ? target : target.substring(0, q);
            Map<String, String> args = query(q < 0 ? "" : target.substring(q + 1));
            route(s.getOutputStream(), method, path, args);
        } catch (IOException e) {
            // the phone went away
        } finally {
            try { s.close(); } catch (IOException e) { /* done */ }
        }
    }

    private void route(OutputStream out, String method, String path, Map<String, String> a) throws IOException {
        if (path.equals("/") || path.equals("/index.html")) {
            asset(out, "remote/index.html");
            return;
        }
        if (path.startsWith("/www/")) {
            String p = path.substring(5);
            if (p.contains("..")) { send(out, 404, "text/plain", "not found"); return; }
            asset(out, "www/" + p);
            return;
        }
        if (!path.startsWith("/api/")) { send(out, 404, "text/plain", "not found"); return; }
        if (!pin.equals(a.get("pin"))) { send(out, 401, "application/json", "{\"ok\":false,\"error\":\"pin\"}"); return; }
        if (path.equals("/api/state")) { send(out, 200, "application/json", actions.state(!a.containsKey("lite"))); return; }
        if (!method.equals("POST")) { send(out, 405, "text/plain", "POST only"); return; }
        boolean ok = true;
        switch (path) {
            case "/api/launch": ok = actions.launch(a.get("id")); break;
            case "/api/radio": actions.radio(); break;
            case "/api/key": ok = actions.key(a.get("k")); break;
            case "/api/home": actions.home(); break;
            case "/api/volume": actions.volume(a.get("d")); break;
            default: send(out, 404, "text/plain", "not found"); return;
        }
        send(out, 200, "application/json", "{\"ok\":" + ok + "}");
    }

    private void asset(OutputStream out, String name) throws IOException {
        InputStream in;
        try {
            in = assets.open(name);
        } catch (IOException e) {
            send(out, 404, "text/plain", "not found");
            return;
        }
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        for (int n; (n = in.read(buf)) > 0; ) b.write(buf, 0, n);
        in.close();
        send(out, 200, type(name), b.toByteArray());
    }

    private static String type(String name) {
        if (name.endsWith(".html")) return "text/html; charset=utf-8";
        if (name.endsWith(".svg")) return "image/svg+xml";
        if (name.endsWith(".png")) return "image/png";
        if (name.endsWith(".jpg")) return "image/jpeg";
        if (name.endsWith(".js")) return "text/javascript; charset=utf-8";
        if (name.endsWith(".css")) return "text/css; charset=utf-8";
        return "application/octet-stream";
    }

    private static void send(OutputStream out, int code, String type, String body) throws IOException {
        if (type.equals("application/json") || type.equals("text/plain")) type += "; charset=utf-8";
        send(out, code, type, body.getBytes(StandardCharsets.UTF_8));
    }

    private static void send(OutputStream out, int code, String type, byte[] body) throws IOException {
        String head = "HTTP/1.1 " + code + (code == 200 ? " OK" : " Error") + "\r\n"
                + "Content-Type: " + type + "\r\n"
                + "Content-Length: " + body.length + "\r\n"
                + "Cache-Control: no-store\r\n"
                + "Connection: close\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.US_ASCII));
        out.write(body);
        out.flush();
    }

    private static Map<String, String> query(String q) {
        Map<String, String> m = new HashMap<>();
        for (String kv : q.split("&")) {
            if (kv.isEmpty()) continue;
            int i = kv.indexOf('=');
            try {
                m.put(URLDecoder.decode(i < 0 ? kv : kv.substring(0, i), "UTF-8"),
                        i < 0 ? "" : URLDecoder.decode(kv.substring(i + 1), "UTF-8"));
            } catch (IOException | IllegalArgumentException e) {
                // skip a malformed pair
            }
        }
        return m;
    }

    // This TV's address on the home network, or null.
    static String address() {
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (a.isSiteLocalAddress() && a.getAddress().length == 4) return a.getHostAddress();
                }
            }
        } catch (IOException e) {
            // no network
        }
        return null;
    }
}
