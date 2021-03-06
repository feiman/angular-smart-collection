/* SmartCollection
 * (c) 2015 by StackEngine under the MIT license
 */

angular.module('SmartCollection', [])
.factory('SmartCollection', function($http){
  return function(config) {

    var loaded = false;
    var routes = config.routes || {};
    var key = config.key || 'id';
    var items = [];
    var itemIndex = {};
    var pendingItems = {};
    var promises = {};
    var model = config.model || (function GenericModel(attrs) {
      var self = this;
      angular.forEach(attrs, function(value, attr) {
        self[attr] = value;
      });
    });

    if (typeof key == 'string')
      key = [key];

    // PRIVATE INTERFACE ------------------------------------------------

    var performRequest = function(routeName, item) {
      var collection = this;
      var route = routes[routeName];


      // Do some sanity checking to make sure required values exist.
      if (!route) throw "Unknown route named '"+routeName+"'";
      angular.forEach(['url', 'method'], function(attr) {
        if (!route[attr]) {
          throw "Route '"+routeName+"' does not have required parameter: "+attr;
        }
      });

      // Convert plain a plain key item to an object so we support both query types
      if (typeof item !== 'object') {
        var obj = {};
        obj[key] = item;
        item = obj;
      }

      // Compose the URL we will be using.
      var url = route.url;
      if (typeof url == 'function') {
        url = route.url.call();
      }
      url = composeUrl(item, url, route.urlKeys);

      // If a request is already in process for this route, lets just
      // piggyback.  Instead of issuing another request, just return the
      // previous promise.
      var promiseKey = route.method+' '+url;
      if (promises[promiseKey]) {
        return promises[promiseKey];
      }

      // Transform the parameters if necessary.
      var params = angular.copy(item);
      if (route.transformRequestData) {
        params = route.transformRequestData(item);
      }
      if (route.requestPrefix) {
        var newParams = {};
        newParams[route.requestPrefix] = params;
        params = newParams;
      }

      var promise = $http[route.method](url, params)
        .then(function(response) {
          var data = response.data;
          if (route.responsePrefix) {
            data = data[route.responsePrefix];
          }
          if (route.transformResponseData) {
            data = route.transformResponseData(response.data, item)
          }

          // If the keys do not exist in the response, add them
          angular.forEach(key, function(k) {
            if (typeof data[k] == 'undefined')
              data[k] = params[k];
          });

          // GET requests will set loaded to true.  This is just a convenience
          // way to know if items have been retrieved.
          if (route.method.toLowerCase() == 'get') {
            loaded = true;
          }

          if (route.responseType == 'array') {
            updateAllItems(data);
            rval = items;
          } else if (route.responseType == 'one') {
            updateOneItem(data);
            rval = indexLookup(itemIndex, data);
          } else if (route.responseType == 'remove') {
            // Ignores the response from the API but removes the item from our
            // collection.
            removeItem(item);
            rval = items;
          } else if (route.responseType == 'ignore' || typeof response.routeType == 'undefined') {
            // By default we will ignore everything sent back from the API.
            rval = data;
          } else {
            throw "Unknown route responseType '"+route.responseType+"' for route "+routeName;
          }

          sortCollection();
          return rval;
        })
        .finally(function() {
          // clean up after ourselves -- since this request is complete, remove
          // our cached promise reference so future requests to this route will
          // generate a new request.
          delete promises[promiseKey];
        });

      promises[promiseKey] = promise;
      return promise;
    };

    var sortCollection = function() {
      if (config.sort)
        items.sort(config.sort);
    };

    var updateAllItems = function(data) {
      // Add new items and update existing items with new values
      var currentKeys = {};
      angular.forEach(data, function(item) {
        var model = updateOneItem(item);
        indexStore(currentKeys, model)
      });
      // Remove items from the array and index.
      for (var i=0; i < items.length; i++) {
        var currentItem = items[i]
        if (!indexLookup(currentKeys, currentItem)) {
          items.splice(i, 1);
          indexRemove(itemIndex, currentItem);
          i--; // decrement since we removed one value from the array
        }
      }
    };

    var updateOneItem = function(data) {
      var item = new model(data);
      return injectItem(item);
    };

    var removeItem = function(item) {
      for (var i=0; i < items.length; i++) {
        var currentItem = items[i];
        if (currentItem[key] == item[key]) {
          items.splice(i, 1);
          indexRemove(itemIndex, item);
          return;
        }
      }
    };

    var injectItem = function(item) {
      var indexItem;
      if (indexItem = indexLookup(itemIndex, item)) {
        angular.extend(indexItem, item);
        return indexItem;
      } else if (indexItem = indexLookup(pendingItems, item)) {
        angular.extend(indexItem, item)
        items.push(indexItem);
        indexStore(itemIndex, indexItem);
        indexRemove(pendingItems, indexItem);
        return indexItem;
      } else {
        items.push(item);
        indexStore(itemIndex, item);
        return item;
      }
    };

    // Takes a url pattern and replaces variables with values from item as
    // mapped by the keys hash.  For example "/users/:id" becomes "/users/3".
    var composeUrl = function(item, url, keys) {
      var matches;
      while (matches = url.match(/:([^\/\?$]+)/)) {
        url = url.replace(matches[0], item[matches[1]]);
      }
      return url;
    };

    var indexLookup = function(indexHandle, obj) {
      for (var i=0; i < key.length; i++) {
        var k = obj[key[i]];
        if (i == key.length-1)
          return indexHandle[k];
        if (!indexHandle[k])
          return;
        indexHandle = indexHandle[k];
      }
    };

    var indexStore = function(indexHandle, obj) {
      for (var i=0; i < key.length; i++) {
        var k = obj[key[i]];
        if (i == key.length-1)
          indexHandle[k] = obj;
        else if (!indexHandle[k])
          indexHandle[k] = {};
        indexHandle = indexHandle[k];
      }
    };

    var indexRemove = function(indexHandle, obj) {
      for (var i=0; i < key.length; i++) {
        var k = obj[key[i]];
        if (i == key.length-1) {
          delete indexHandle[k];
        } else
          indexHandle = indexHandle[k];
      }
    };

    // PUBLIC INTERFACE ------------------------------------------------

    var SmartCollection = function() {};
    SmartCollection.prototype.items = function() { return items; };
    SmartCollection.prototype.item = function(obj) {
      if (typeof obj != 'object') {
        newObj = {};
        newObj[key[0]] = obj;
        obj = newObj;
      }

      var indexItem;
      if (typeof (indexItem = indexLookup(itemIndex, obj)) !== 'undefined') {
        return indexItem;
      } else if (typeof (indexItem = indexLookup(pendingItems, obj)) !== 'undefined') {
        return indexItem;
      } else {
        var pendingObj = new model(obj);
        indexStore(pendingItems, pendingObj);
        return pendingObj;
      }
    };
    SmartCollection.prototype.lookup = function(obj) {
      if (typeof obj == 'string') {
        obj = {};
        obj[key[0]] = obj;
      }
      return indexLookup(itemIndex, obj);
    }

    // Create a function for each route dynamically
    angular.forEach(routes, function(route, routeName) {
      if (SmartCollection.prototype[routeName])
        throw "Cannot create a route using reserved name '"+routeName+"'";
      SmartCollection.prototype[routeName] = function(item) {
        return performRequest(routeName, item);
      };
    });

    // Bootstrap the items with default data if provided
    if (config.bootstrap)
      updateAllItems(config.bootstrap);

    return new SmartCollection();
  };
});
