angular.module('smartRepeat', [])

.directive('smartRepeat', ['$parse', '$animate', function($parse, $animate) {
    var uid      = ['0', '0', '0'],
        ngMinErr = angular.$$minErr('ng');

    function assertNotHasOwnProperty(name, context) {
        if (name === 'hasOwnProperty') {
            throw ngMinErr('badname', "hasOwnProperty is not a valid {0} name", context);
        }
    }

    function nextUid() {
        var index = uid.length;
        var digit;

        while(index) {
            index--;
            digit = uid[index].charCodeAt(0);
            if (digit == 57 /*'9'*/) {
                uid[index] = 'A';
                return uid.join('');
            }
            if (digit == 90  /*'Z'*/) {
                uid[index] = '0';
            } else {
                uid[index] = String.fromCharCode(digit + 1);
                return uid.join('');
            }
        }
        uid.unshift('0');
        return uid.join('');
    }

    function hashKey(obj) {
        var objType = typeof obj,
            key;

        if (objType == 'object' && obj !== null) {
            if (typeof (key = obj.$$hashKey) == 'function') {
                // must invoke on object to keep the right this
                key = obj.$$hashKey();
            } else if (key === undefined) {
                key = obj.$$hashKey = nextUid();
            }
        } else {
            key = obj;
        }

        return objType + ':' + key;
    }

    function isWindow(obj) {
        return obj && obj.document && obj.location && obj.alert && obj.setInterval;
    }

    function isArrayLike(obj) {
        if (obj == null || isWindow(obj)) {
            return false;
        }

        var length = obj.length;

        if (obj.nodeType === 1 && length) {
            return true;
        }

        return angular.isString(obj) || angular.isArray(obj) || length === 0 ||
            typeof length === 'number' && length > 0 && (length - 1) in obj;
    }

    function getBlockElements(nodes) {
        var startNode = nodes[0],
            endNode = nodes[nodes.length - 1];
        if (startNode === endNode) {
            return $(startNode);
        }

        var element = startNode;
        var elements = [element];

        do {
            element = element.nextSibling;
            if (!element) break;
            elements.push(element);
        } while (element !== endNode);

        return $(elements);
    }

    function getBlockStart(block) {
        return block.clone[0];
    }

    function getBlockEnd(block) {
        return block.clone[block.clone.length - 1];
    }

    var NG_REMOVED = '$$NG_REMOVED';
    var ngRepeatMinErr = angular.$$minErr('ngRepeat');

    return {
        transclude: 'element',
        priority: 1000,
        terminal: true,
        $$tlb: true,
        link: function($scope, $element, $attr, ctrl, $transclude){
            var expression = $attr.smartRepeat;
            var match = expression.match(/^\s*([\s\S]+?)\s+in\s+([\s\S]+?)(?:\s+track\s+by\s+([\s\S]+?))?\s*$/),
                trackByExp, trackByExpGetter, trackByIdExpFn, trackByIdArrayFn, trackByIdObjFn,
                lhs, rhs, valueIdentifier, keyIdentifier,
                hashFnLocals = {$id: hashKey};

            if (!match) {
                throw ngRepeatMinErr('iexp', "Expected expression in form of '_item_ in _collection_[ track by _id_]' but got '{0}'.",
                    expression);
            }

            lhs = match[1];
            rhs = match[2];
            trackByExp = match[3];

            if (trackByExp) {
                trackByExpGetter = $parse(trackByExp);
                trackByIdExpFn = function(key, value, index) {
                    // assign key, value, and $index to the locals so that they can be used in hash functions
                    if (keyIdentifier) hashFnLocals[keyIdentifier] = key;
                    hashFnLocals[valueIdentifier] = value;
                    hashFnLocals.$index = index;
                    return trackByExpGetter($scope, hashFnLocals);
                };
            } else {
                trackByIdArrayFn = function(key, value) {
                    return hashKey(value);
                };
                trackByIdObjFn = function(key) {
                    return key;
                };
            }

            match = lhs.match(/^(?:([\$\w]+)|\(([\$\w]+)\s*,\s*([\$\w]+)\))$/);
            if (!match) {
                throw ngRepeatMinErr('iidexp', "'_item_' in '_item_ in _collection_' should be an identifier or '(_key_, _value_)' expression, but got '{0}'.",
                    lhs);
            }
            valueIdentifier = match[3] || match[1];
            keyIdentifier = match[2];

            // Store a list of elements from previous run. This is a hash where key is the item from the
            // iterator, and the value is objects with following properties.
            //   - scope: bound scope
            //   - element: previous element.
            //   - index: position
            var lastBlockMap = {};

            // ***************** Pre rendered items ********************
            var preRenderedOrder = [],
                collection       = $parse(rhs)($scope);

            $element.siblings().each(function(index, element) {
                preRenderedOrder[index] = {
                    value: $(element).attr('ht-item'),
                    element: $(element)
                };
            });

            if (isArrayLike(collection)) {
                for (var i = preRenderedOrder.length - 1; i >= 0; i--) {
                    collection.unshift(preRenderedOrder[i].value);
                }
            }
            else {
                /* TODO */
            }
            // **************************************************************

            //watch props
            $scope.$watchCollection(rhs, function ngRepeatAction(collection){
                var index, length,
                    previousNode = $element[0],     // current position of the node
                    nextNode,
                // Same as lastBlockMap but it has the current state. It will become the
                // lastBlockMap on the next iteration.
                    nextBlockMap = {},
                    arrayLength,
                    childScope,
                    key, value, // key/value of iteration
                    trackById,
                    trackByIdFn,
                    collectionKeys,
                    block,       // last object information {scope, element, id}
                    nextBlockOrder = [],
                    elementsToRemove;


                if (isArrayLike(collection)) {
                    collectionKeys = collection;
                    trackByIdFn = trackByIdExpFn || trackByIdArrayFn;
                } else {
                    trackByIdFn = trackByIdExpFn || trackByIdObjFn;
                    // if object, extract keys, sort them and use to determine order of iteration over obj props
                    collectionKeys = [];
                    for (key in collection) {
                        if (collection.hasOwnProperty(key) && key.charAt(0) != '$') {
                            collectionKeys.push(key);
                        }
                    }
                    collectionKeys.sort();
                }

                arrayLength = collectionKeys.length;

                // locate existing items
                length = nextBlockOrder.length = collectionKeys.length;
                for(index = 0; index < length; index++) {
                    key = (collection === collectionKeys) ? index : collectionKeys[index];
                    value = collection[key];
                    trackById = trackByIdFn(key, value, index);
                    assertNotHasOwnProperty(trackById, '`track by` id');

                    if(lastBlockMap.hasOwnProperty(trackById)) {
                        block = lastBlockMap[trackById];
                        delete lastBlockMap[trackById];
                        nextBlockMap[trackById] = block;
                        nextBlockOrder[index] = block;
                    } else if (nextBlockMap.hasOwnProperty(trackById)) {
                        // restore lastBlockMap
                        angular.forEach(nextBlockOrder, function(block) {
                            if (block && block.scope) lastBlockMap[block.id] = block;
                        });
                        // This is a duplicate and we need to throw an error
//                        throw ngRepeatMinErr('dupes', "Duplicates in a repeater are not allowed. Use 'track by' expression to specify unique keys. Repeater: {0}, Duplicate key: {1}",
//                            expression,       trackById);
                    } else {
                        // new never before seen block
                        nextBlockOrder[index] = { id: trackById };
                        nextBlockMap[trackById] = false;

                        // Pre rendered element
                        if (preRenderedOrder[index]) {
                            nextBlockOrder[index].clone = preRenderedOrder[index].element;
                        }
                    }
                }

                // remove existing items
                for (key in lastBlockMap) {
                    // lastBlockMap is our own object so we don't need to use special hasOwnPropertyFn
                    if (lastBlockMap.hasOwnProperty(key)) {
                        block = lastBlockMap[key];
                        elementsToRemove = getBlockElements(block.clone);
                        $animate.leave(elementsToRemove);
                        angular.forEach(elementsToRemove, function(element) { element[NG_REMOVED] = true; });
                        block.scope.$destroy();
                    }
                }

                // we are not using forEach for perf reasons (trying to avoid #call)
                for (index = 0, length = collectionKeys.length; index < length; index++) {
                    key = (collection === collectionKeys) ? index : collectionKeys[index];
                    value = collection[key];
                    block = nextBlockOrder[index];
                    if (nextBlockOrder[index - 1]) previousNode = getBlockEnd(nextBlockOrder[index - 1]);

                    if (block.scope) {
                        // if we have already seen this object, then we need to reuse the
                        // associated scope/element
                        childScope = block.scope;

                        nextNode = previousNode;
                        do {
                            nextNode = nextNode.nextSibling;
                        } while(nextNode && nextNode[NG_REMOVED]);

                        if (getBlockStart(block) != nextNode) {
                            // existing item which got moved
                            $animate.move(getBlockElements(block.clone), null, $(previousNode));
                        }
                        previousNode = getBlockEnd(block);
                    } else {
                        // new item which we don't know about
                        childScope = $scope.$new();
                    }

                    childScope[valueIdentifier] = value;
                    if (keyIdentifier) childScope[keyIdentifier] = key;
                    childScope.$index = index;
                    childScope.$first = (index === 0);
                    childScope.$last = (index === (arrayLength - 1));
                    childScope.$middle = !(childScope.$first || childScope.$last);
                    // jshint bitwise: false
                    childScope.$odd = !(childScope.$even = (index&1) === 0);
                    // jshint bitwise: true

                    if (! block.scope) {
                        if (block.clone) {
                            var comment = $(document.createComment(' end ngRepeat: ' + expression + ' ')).insertAfter(block.clone);
                            block.clone[block.clone.length++] = comment[0];

                            previousNode = block.clone;

                            block.scope = childScope;
                            nextBlockMap[block.id] = block;

                            // TODO ASSIGN NEW SCOPE TO EXISTING ELEMENT
                        }
                        else {
                            $transclude(childScope, function(clone) {
                                clone[clone.length++] = document.createComment(' end ngRepeat: ' + expression + ' ');

                                $animate.enter(clone, null, $(previousNode));
                                previousNode = clone;

                                block.scope = childScope;
                                // Note: We only need the first/last node of the cloned nodes.
                                // However, we need to keep the reference to the jqlite wrapper as it might be changed later
                                // by a directive with templateUrl when it's template arrives.
                                block.clone = clone;
                                nextBlockMap[block.id] = block;
                            });
                        }
                    }
                }

                lastBlockMap = nextBlockMap;

                ///////////////
                if (preRenderedOrder.length) {
                    preRenderedOrder.length = 0;
                }
            });
        }
    }
}]);
