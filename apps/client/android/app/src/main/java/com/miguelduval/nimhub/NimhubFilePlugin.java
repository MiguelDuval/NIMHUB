package com.miguelduval.nimhub;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;

@CapacitorPlugin(name = "NimhubFile")
public class NimhubFilePlugin extends Plugin {
    private Uri collectionForMime(String mimeType) {
        String mime = mimeType == null ? "" : mimeType.toLowerCase();
        if (mime.startsWith("image/")) return MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
        if (mime.startsWith("video/")) return MediaStore.Video.Media.EXTERNAL_CONTENT_URI;
        if (mime.startsWith("audio/")) return MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
        return MediaStore.Downloads.EXTERNAL_CONTENT_URI;
    }

    private String relativePathForMime(String mimeType) {
        String mime = mimeType == null ? "" : mimeType.toLowerCase();
        if (mime.startsWith("image/")) return Environment.DIRECTORY_PICTURES + "/NIM Hub";
        if (mime.startsWith("video/")) return Environment.DIRECTORY_MOVIES + "/NIM Hub";
        if (mime.startsWith("audio/")) return Environment.DIRECTORY_MUSIC + "/NIM Hub";
        return Environment.DIRECTORY_DOWNLOADS + "/NIM Hub";
    }

    @PluginMethod
    public void saveBase64(PluginCall call) {
        String fileName = call.getString("fileName");
        String mimeType = call.getString("mimeType", "application/octet-stream");
        String dataBase64 = call.getString("dataBase64");

        if (fileName == null || fileName.trim().isEmpty() || dataBase64 == null || dataBase64.isEmpty()) {
            call.reject("fileName and dataBase64 are required");
            return;
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("Native MediaStore export requires Android 10 or newer");
            return;
        }

        ContentResolver resolver = getContext().getContentResolver();
        Uri collection = collectionForMime(mimeType);
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName.replace("/", "_").replace("\\", "_"));
        values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, relativePathForMime(mimeType));
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);

        Uri uri = resolver.insert(collection, values);
        if (uri == null) {
            call.reject("Could not create a MediaStore destination");
            return;
        }

        try {
            byte[] bytes = Base64.decode(dataBase64, Base64.DEFAULT);
            try (OutputStream output = resolver.openOutputStream(uri)) {
                if (output == null) throw new IllegalStateException("Could not open MediaStore output");
                output.write(bytes);
                output.flush();
            }

            ContentValues published = new ContentValues();
            published.put(MediaStore.MediaColumns.IS_PENDING, 0);
            resolver.update(uri, published, null, null);

            JSObject result = new JSObject();
            result.put("uri", uri.toString());
            result.put("fileName", fileName);
            result.put("mimeType", mimeType);
            call.resolve(result);
        } catch (Exception e) {
            resolver.delete(uri, null, null);
            call.reject("Native media export failed");
        }
    }
}
