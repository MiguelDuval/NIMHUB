package com.miguelduval.nimhub;

import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "NimhubMediaHttp")
public class NimhubMediaHttpPlugin extends Plugin {
    private static final String CRLF = "\r\n";
    private static final String TWO_HYPHENS = "--";

    private byte[] readAll(InputStream input) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int read;
        while ((read = input.read(buffer)) != -1) {
            output.write(buffer, 0, read);
        }
        return output.toByteArray();
    }

    private String safeHeaderValue(String value) {
        return value.replace("\"", "_").replace("\r", "_").replace("\n", "_");
    }

    private void writeTextPart(OutputStream output, String boundary, String name, String value) throws Exception {
        output.write((TWO_HYPHENS + boundary + CRLF).getBytes(StandardCharsets.UTF_8));
        output.write(("Content-Disposition: form-data; name=\"" + safeHeaderValue(name) + "\"" + CRLF).getBytes(StandardCharsets.UTF_8));
        output.write(CRLF.getBytes(StandardCharsets.UTF_8));
        output.write(value.getBytes(StandardCharsets.UTF_8));
        output.write(CRLF.getBytes(StandardCharsets.UTF_8));
    }

    private void writeFilePart(OutputStream output, String boundary, String base64, String fieldName, String fileName, String mimeType) throws Exception {
        output.write((TWO_HYPHENS + boundary + CRLF).getBytes(StandardCharsets.UTF_8));
        output.write(("Content-Disposition: form-data; name=\"" + safeHeaderValue(fieldName) + "\"; filename=\"" + safeHeaderValue(fileName) + "\"" + CRLF).getBytes(StandardCharsets.UTF_8));
        output.write(("Content-Type: " + safeHeaderValue(mimeType) + CRLF).getBytes(StandardCharsets.UTF_8));
        output.write(CRLF.getBytes(StandardCharsets.UTF_8));
        output.write(Base64.decode(base64, Base64.DEFAULT));
        output.write(CRLF.getBytes(StandardCharsets.UTF_8));
    }

    @PluginMethod
    public void postMultipart(PluginCall call) {
        String urlValue = call.getString("url");
        String apiKey = call.getString("apiKey");
        JSObject fields = call.getObject("fields");
        String fileBase64 = call.getString("fileBase64");
        String fileName = call.getString("fileName", "upload.bin");
        String fileMimeType = call.getString("fileMimeType", "application/octet-stream");
        String fileFieldName = call.getString("fileFieldName", "file");
        int connectTimeout = call.getInt("connectTimeout", 30000);
        int readTimeout = call.getInt("readTimeout", 120000);

        if (urlValue == null || urlValue.isEmpty() || apiKey == null || apiKey.isEmpty()) {
            call.reject("url and apiKey are required");
            return;
        }

        HttpURLConnection connection = null;
        try {
            String boundary = "----NIMHubBoundary" + System.currentTimeMillis();
            connection = (HttpURLConnection) new URL(urlValue).openConnection();
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setDoInput(true);
            connection.setConnectTimeout(connectTimeout);
            connection.setReadTimeout(readTimeout);
            connection.setRequestProperty("Authorization", "Bearer " + apiKey);
            connection.setRequestProperty("Accept", "*/*");
            connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);

            try (OutputStream output = connection.getOutputStream()) {
                if (fields != null) {
                    java.util.Iterator<String> names = fields.keys();
                    while (names.hasNext()) {
                        String name = names.next();
                        Object value = fields.opt(name);
                        if (value != null) writeTextPart(output, boundary, name, String.valueOf(value));
                    }
                }
                if (fileBase64 != null && !fileBase64.isEmpty()) {
                    writeFilePart(output, boundary, fileBase64, fileFieldName, fileName, fileMimeType);
                }
                output.write((TWO_HYPHENS + boundary + TWO_HYPHENS + CRLF).getBytes(StandardCharsets.UTF_8));
                output.flush();
            }

            int status = connection.getResponseCode();
            InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            byte[] bytes = input == null ? new byte[0] : readAll(input);

            JSObject result = new JSObject();
            result.put("status", status);
            result.put("contentType", connection.getContentType() == null ? "" : connection.getContentType());
            result.put("data_base64", Base64.encodeToString(bytes, Base64.NO_WRAP));
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Native multipart request failed");
        } finally {
            if (connection != null) connection.disconnect();
        }
    }
}
