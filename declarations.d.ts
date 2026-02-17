// declarations.d.ts
declare module "react-native-paystack-webview" {
  import * as React from "react";
  import { ViewStyle } from "react-native";

  export interface PaystackWebViewProps {
    paystackKey: string;
    amount: number;
    billingEmail: string;
    billingName?: string;
    billingMobile?: string;
    currency?: string;
    channels?: string[];
    activityIndicatorColor?: string;
    SafeAreaViewContainer?: React.ComponentType<any>;
    SafeAreaViewContainerModal?: React.ComponentType<any>;
    style?: ViewStyle;
    onSuccess?: (res: { transactionRef: { reference: string } }) => void;
    onCancel?: () => void;
  }

  const PaystackWebView: React.FC<PaystackWebViewProps>;
  export default PaystackWebView;
}
