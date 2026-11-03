package com.glasshome.firetv;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;

import java.io.DataInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.math.BigInteger;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.crypto.Cipher;

/*
 * Remote keys for any app in front. Apps can't send keys to other apps, so
 * these go to the TV's own adb service on this box (127.0.0.1:5555, already on
 * for installing this app) as "input keyevent". The first time, the TV asks
 * "Allow debugging?" for this app's key; tick "Always allow" and press OK.
 * Only key codes are ever sent. Keys pressed while one is on its way go
 * together in one command.
 */
class AdbKeys {
    private static final int CNXN = 0x4e584e43, AUTH = 0x48545541, OPEN = 0x4e45504f,
            OKAY = 0x59414b4f, CLSE = 0x45534c43, WRTE = 0x45545257;
    private static final byte[] SHA1_PREFIX = { 0x30, 0x21, 0x30, 0x09, 0x06, 0x05, 0x2b, 0x0e, 0x03, 0x02, 0x1a, 0x05, 0x00, 0x04, 0x14 };
    private static final int APPROVE_WAIT_MS = 60000;   // time to answer the TV's question

    private final Context context;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final List<Integer> pending = new ArrayList<>();
    private Socket socket;
    private DataInputStream in;
    private OutputStream out;
    private int nextId = 1;
    private KeyPair keys;

    AdbKeys(Context context) { this.context = context.getApplicationContext(); }

    void send(int keyCode) {
        synchronized (pending) {
            pending.add(keyCode);
            if (pending.size() > 1) return;              // joins the command already queued
        }
        worker.execute(new Runnable() {
            @Override
            public void run() {
                StringBuilder cmd = new StringBuilder("input keyevent");
                synchronized (pending) {
                    for (int c : pending) cmd.append(' ').append(c);
                    pending.clear();
                }
                for (int attempt = 0; attempt < 2; attempt++) {
                    try {
                        if (socket == null) connect();
                        exec(cmd.toString());
                        return;
                    } catch (Exception e) {
                        close();                        // stale connection: one fresh try
                    }
                }
            }
        });
    }

    void stop() {
        worker.shutdownNow();
        close();
    }

    // ---------- connection ----------
    private void connect() throws Exception {
        Socket s = new Socket();
        s.connect(new InetSocketAddress("127.0.0.1", 5555), 3000);
        s.setSoTimeout(APPROVE_WAIT_MS);
        socket = s;
        in = new DataInputStream(s.getInputStream());
        out = s.getOutputStream();
        write(CNXN, 0x01000000, 256 * 1024, "host::\0".getBytes(StandardCharsets.US_ASCII));
        boolean signed = false;
        boolean offered = false;
        while (true) {
            int[] h = new int[6];
            byte[] data = read(h);
            if (h[0] == CNXN) break;
            if (h[0] != AUTH || h[1] != 1) continue;            // 1: a token to sign
            if (!signed) {
                write(AUTH, 2, 0, sign(data));
                signed = true;
            } else if (!offered) {
                write(AUTH, 3, 0, publicKey());                  // the TV now asks to allow it
                offered = true;
            } else {
                throw new IOException("not allowed");
            }
        }
        s.setSoTimeout(10000);
    }

    // Runs one shell command and waits for it to end.
    private void exec(String cmd) throws IOException {
        int local = nextId++;
        write(OPEN, local, 0, ("shell:" + cmd + "\0").getBytes(StandardCharsets.UTF_8));
        int remote = 0;
        while (true) {
            int[] h = new int[6];
            read(h);
            if (h[2] != local) continue;
            if (h[0] == OKAY) remote = h[1];
            else if (h[0] == WRTE) write(OKAY, local, h[1], new byte[0]);
            else if (h[0] == CLSE) {
                if (remote != 0) write(CLSE, local, remote, new byte[0]);
                return;
            }
        }
    }

    private void close() {
        try { if (socket != null) socket.close(); } catch (IOException e) { /* closing anyway */ }
        socket = null;
    }

    // ---------- messages: 24-byte little-endian header, then the payload ----------
    private void write(int cmd, int arg0, int arg1, byte[] data) throws IOException {
        int sum = 0;
        for (byte b : data) sum += b & 0xff;
        ByteBuffer h = ByteBuffer.allocate(24).order(ByteOrder.LITTLE_ENDIAN);
        h.putInt(cmd).putInt(arg0).putInt(arg1).putInt(data.length).putInt(sum).putInt(~cmd);
        out.write(h.array());
        out.write(data);
        out.flush();
    }

    private byte[] read(int[] h) throws IOException {
        byte[] raw = new byte[24];
        in.readFully(raw);
        ByteBuffer b = ByteBuffer.wrap(raw).order(ByteOrder.LITTLE_ENDIAN);
        for (int i = 0; i < 6; i++) h[i] = b.getInt();
        if (h[3] < 0 || h[3] > 1024 * 1024) throw new IOException("bad message");
        byte[] data = new byte[h[3]];
        in.readFully(data);
        return data;
    }

    // ---------- this app's key, made once ----------
    private KeyPair keyPair() throws Exception {
        if (keys != null) return keys;
        SharedPreferences p = context.getSharedPreferences("adb", Context.MODE_PRIVATE);
        KeyFactory kf = KeyFactory.getInstance("RSA");
        String priv = p.getString("priv", null), pub = p.getString("pub", null);
        if (priv != null && pub != null) {
            keys = new KeyPair(kf.generatePublic(new X509EncodedKeySpec(Base64.decode(pub, Base64.NO_WRAP))),
                    kf.generatePrivate(new PKCS8EncodedKeySpec(Base64.decode(priv, Base64.NO_WRAP))));
        } else {
            KeyPairGenerator g = KeyPairGenerator.getInstance("RSA");
            g.initialize(2048);
            keys = g.generateKeyPair();
            p.edit().putString("priv", Base64.encodeToString(keys.getPrivate().getEncoded(), Base64.NO_WRAP))
                    .putString("pub", Base64.encodeToString(keys.getPublic().getEncoded(), Base64.NO_WRAP)).apply();
        }
        return keys;
    }

    // adb signs the token as if it were a SHA-1 digest.
    private byte[] sign(byte[] token) throws Exception {
        PrivateKey k = keyPair().getPrivate();
        Cipher c = Cipher.getInstance("RSA/ECB/PKCS1Padding");
        c.init(Cipher.ENCRYPT_MODE, k);
        byte[] msg = new byte[SHA1_PREFIX.length + token.length];
        System.arraycopy(SHA1_PREFIX, 0, msg, 0, SHA1_PREFIX.length);
        System.arraycopy(token, 0, msg, SHA1_PREFIX.length, token.length);
        return c.doFinal(msg);
    }

    // Android's RSAPublicKey struct, base64, then a name the TV shows.
    private byte[] publicKey() throws Exception {
        RSAPublicKey k = (RSAPublicKey) keyPair().getPublic();
        BigInteger n = k.getModulus();
        BigInteger r32 = BigInteger.ONE.shiftLeft(32);
        BigInteger n0inv = r32.subtract(n.mod(r32).modInverse(r32));
        BigInteger rr = BigInteger.ONE.shiftLeft(4096).mod(n);
        ByteBuffer b = ByteBuffer.allocate(524).order(ByteOrder.LITTLE_ENDIAN);
        b.putInt(64).putInt(n0inv.intValue()).put(le(n)).put(le(rr)).putInt(k.getPublicExponent().intValue());
        String s = Base64.encodeToString(b.array(), Base64.NO_WRAP) + " glasshome@tv\0";
        return s.getBytes(StandardCharsets.US_ASCII);
    }

    private static byte[] le(BigInteger v) {
        byte[] be = v.toByteArray();
        byte[] r = new byte[256];
        for (int i = 0; i < 256 && i < be.length; i++) r[i] = be[be.length - 1 - i];
        return r;
    }
}
