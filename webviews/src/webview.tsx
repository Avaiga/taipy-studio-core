import { useEffect, lazy, useState, Suspense } from "react";

import { ViewMessage } from "../../shared/messages";
import {
  ConfigEditorId,
  ConfigEditorProps,
  DataNodeDetailsId,
  DataNodeDetailsProps,
  NoDetailsId,
  NoDetailsProps,
} from "../../shared/views";
import { postRefreshMessage } from "./components/utils";

const NoDetails = lazy(
  () => import(/* webpackChunkName: "NoDetails" */ "./components/NoDetails")
);
const DataNodeDetails = lazy(
  () =>
    import(
      /* webpackChunkName: "DataNodeDetails" */ "./components/DataNodeDetails"
    )
);
const Editor = lazy(
  () => import(/* webpackChunkName: "Editor" */ "./components/Editor")
);

const Loading = () => <div>Loading...</div>;

const WebView = () => {
  const [message, setMessage] = useState<ViewMessage>();

  useEffect(() => {
    // Manage Post Message reception
    const messageListener = (event: MessageEvent) =>
      setMessage(event.data as ViewMessage);
    window.addEventListener("message", messageListener);
    return () => window.removeEventListener("message", messageListener);
  }, []);

  useEffect(() => {
    message || postRefreshMessage();
  }, [message]);
  
  if (message) {
    switch (message.name) {
      case NoDetailsId:
        return (
          <Suspense fallback={<Loading />}>
            <NoDetails {...(message.props as NoDetailsProps)} />
          </Suspense>
        );
      case DataNodeDetailsId:
        return (
          <Suspense fallback={<Loading />}>
            <DataNodeDetails {...(message.props as DataNodeDetailsProps)} />
          </Suspense>
        );
      case ConfigEditorId:
        return (
          <Suspense fallback={<Loading />}>
            <Editor {...(message.props as ConfigEditorProps)} />
          </Suspense>
        );
      default:
        break;
    }
  }
  return <Loading />;
};

export default WebView;
