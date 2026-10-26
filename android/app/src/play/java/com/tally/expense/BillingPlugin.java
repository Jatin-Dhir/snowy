package com.tally.expense;

import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClient.BillingResponseCode;
import com.android.billingclient.api.BillingClient.ProductType;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

// Google Play Billing for Taily Pro, a one-time purchase that is never consumed.
// src/lib/pro.ts drives it. Only the Play build includes this file.
@CapacitorPlugin(name = "Billing")
public class BillingPlugin extends Plugin implements PurchasesUpdatedListener {
  private BillingClient client;
  private final List<Runnable> waiting = new ArrayList<>();
  private boolean connecting = false;
  private PluginCall purchaseCall;
  private String purchaseProductId;

  private interface DetailsCallback {
    void done(ProductDetails details);
  }

  @Override
  public void load() {
    client = BillingClient.newBuilder(getContext())
        .setListener(this)
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .enableAutoServiceReconnection()
        .build();
    connecting = true;
    client.startConnection(new BillingClientStateListener() {
      @Override
      public void onBillingSetupFinished(BillingResult result) {
        List<Runnable> ready;
        synchronized (waiting) {
          connecting = false;
          ready = new ArrayList<>(waiting);
          waiting.clear();
        }
        // on failure the queued calls still run, and come back with Play's own error
        for (Runnable task : ready) task.run();
      }

      @Override
      public void onBillingServiceDisconnected() {
        // enableAutoServiceReconnection() reconnects on the next call that needs Play
      }
    });
  }

  @Override
  protected void handleOnDestroy() {
    if (client != null) client.endConnection();
  }

  /** Runs now, or once the first connection to Play has settled. */
  private void whenConnected(Runnable task) {
    synchronized (waiting) {
      if (connecting) {
        waiting.add(task);
        return;
      }
    }
    task.run();
  }

  private void details(String productId, DetailsCallback callback) {
    QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
        .setProductList(Collections.singletonList(
            QueryProductDetailsParams.Product.newBuilder()
                .setProductId(productId)
                .setProductType(ProductType.INAPP)
                .build()))
        .build();
    client.queryProductDetailsAsync(params, (result, found) -> {
      ProductDetails match = null;
      if (result.getResponseCode() == BillingResponseCode.OK) {
        for (ProductDetails d : found.getProductDetailsList()) {
          if (productId.equals(d.getProductId())) match = d;
        }
      }
      callback.done(match);
    });
  }

  private static ProductDetails.OneTimePurchaseOfferDetails offerOf(ProductDetails d) {
    List<ProductDetails.OneTimePurchaseOfferDetails> offers = d.getOneTimePurchaseOfferDetailsList();
    if (offers != null && !offers.isEmpty()) return offers.get(0);
    return d.getOneTimePurchaseOfferDetails();
  }

  @PluginMethod
  public void product(PluginCall call) {
    String productId = call.getString("productId");
    if (productId == null) {
      call.reject("productId is required");
      return;
    }
    whenConnected(() -> details(productId, (d) -> {
      JSObject ret = new JSObject();
      ret.put("available", d != null);
      ProductDetails.OneTimePurchaseOfferDetails offer = d != null ? offerOf(d) : null;
      if (offer != null) ret.put("price", offer.getFormattedPrice());
      call.resolve(ret);
    }));
  }

  @PluginMethod
  public void purchase(PluginCall call) {
    String productId = call.getString("productId");
    if (productId == null) {
      call.reject("productId is required");
      return;
    }
    whenConnected(() -> details(productId, (d) -> {
      if (d == null) {
        JSObject ret = new JSObject();
        ret.put("result", "error");
        ret.put("message", "Google Play doesn't have this product");
        call.resolve(ret);
        return;
      }
      BillingFlowParams.ProductDetailsParams.Builder item =
          BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(d);
      ProductDetails.OneTimePurchaseOfferDetails offer = offerOf(d);
      if (offer != null && offer.getOfferToken() != null) item.setOfferToken(offer.getOfferToken());
      BillingFlowParams params = BillingFlowParams.newBuilder()
          .setProductDetailsParamsList(Collections.singletonList(item.build()))
          .build();
      // the purchase screen must be launched from the main thread
      getActivity().runOnUiThread(() -> {
        synchronized (this) {
          purchaseCall = call;
          purchaseProductId = productId;
        }
        BillingResult launched = client.launchBillingFlow(getActivity(), params);
        if (launched.getResponseCode() != BillingResponseCode.OK) onPurchasesUpdated(launched, null);
      });
    }));
  }

  @PluginMethod
  public void owned(PluginCall call) {
    String productId = call.getString("productId");
    if (productId == null) {
      call.reject("productId is required");
      return;
    }
    whenConnected(() -> client.queryPurchasesAsync(
        QueryPurchasesParams.newBuilder().setProductType(ProductType.INAPP).build(),
        (result, purchases) -> {
          if (result.getResponseCode() != BillingResponseCode.OK) {
            call.reject("Couldn't reach Google Play: " + result.getDebugMessage(), String.valueOf(result.getResponseCode()));
            return;
          }
          boolean owned = false;
          boolean pending = false;
          for (Purchase p : purchases) {
            if (!p.getProducts().contains(productId)) continue;
            if (p.getPurchaseState() == Purchase.PurchaseState.PURCHASED) {
              owned = true;
              acknowledge(p);
            } else if (p.getPurchaseState() == Purchase.PurchaseState.PENDING) {
              pending = true;
            }
          }
          JSObject ret = new JSObject();
          ret.put("owned", owned);
          ret.put("pending", pending);
          call.resolve(ret);
        }));
  }

  // Play refunds a purchase that isn't acknowledged within three days
  private void acknowledge(Purchase p) {
    if (p.isAcknowledged()) return;
    client.acknowledgePurchase(
        AcknowledgePurchaseParams.newBuilder().setPurchaseToken(p.getPurchaseToken()).build(),
        (result) -> {});
  }

  @Override
  public void onPurchasesUpdated(BillingResult result, List<Purchase> purchases) {
    PluginCall call;
    String productId;
    synchronized (this) {
      call = purchaseCall;
      productId = purchaseProductId;
      purchaseCall = null;
      purchaseProductId = null;
    }
    int code = result.getResponseCode();
    String outcome = "error";
    if (code == BillingResponseCode.OK && purchases != null) {
      for (Purchase p : purchases) {
        boolean bought = p.getPurchaseState() == Purchase.PurchaseState.PURCHASED;
        boolean pending = p.getPurchaseState() == Purchase.PurchaseState.PENDING;
        if (bought) acknowledge(p);
        for (String id : p.getProducts()) {
          // also reaches the app for purchases that finish later, with no call waiting
          JSObject e = new JSObject();
          e.put("productId", id);
          e.put("owned", bought);
          e.put("pending", pending);
          notifyListeners("purchaseUpdated", e);
          if (id.equals(productId)) outcome = bought ? "purchased" : pending ? "pending" : "error";
        }
      }
    } else if (code == BillingResponseCode.USER_CANCELED) {
      outcome = "canceled";
    } else if (code == BillingResponseCode.ITEM_ALREADY_OWNED) {
      outcome = "owned";
    }
    if (call == null) return;
    JSObject ret = new JSObject();
    ret.put("result", outcome);
    if (outcome.equals("error")) ret.put("message", result.getDebugMessage());
    call.resolve(ret);
  }
}
