/**
 * Module dependencies
 */

var _ = require('lodash');
var utils = require('./lib/utils');
var hop = utils.object.hasOwnProperty;

/**
 * Build Select statements.
 *
 * Given a Waterline Query Object determine which select statements will be needed.
 */

var SelectBuilder = module.exports = function(schema, currentTable, queryObject, options) {

  this.schema = schema;
  this.currentTable = currentTable;
  this.escapeCharacter = '"';
  this.cast = false;
  this.wlNext = {};

  if(options && hop(options, 'escapeCharacter')) {
    this.escapeCharacter = options.escapeCharacter;
  }

  if(options && hop(options, 'cast')) {
    this.cast = options.cast;
  }

  // Add support for WLNext features
  if(options && hop(options, 'wlNext')) {
    this.wlNext = options.wlNext;
  }

  var queries = [];
  queries.push(this.buildSimpleSelect(queryObject));

  return {
    select: queries
  };
};

/**
 * Build a simple Select statement.
 */

SelectBuilder.prototype.buildSimpleSelect = function buildSimpleSelect(queryObject) {

  var self = this;

  // Check for aggregations
  var aggregations = this.processAggregates(queryObject);
  if(aggregations) {
    return aggregations;
  }

  // Escape table name
  var tableName = utils.escapeName(self.schema[self.currentTable].tableName, self.escapeCharacter);

  var selectKeys = [];
  var query = 'SELECT ';

  var attributes = queryObject.select || Object.keys(this.schema[this.currentTable].attributes);
  delete queryObject.select;

  attributes.forEach(function(key) {
    // Default schema to {} in case a raw DB column name is sent.  This shouldn't happen
    // after https://github.com/balderdashy/waterline/commit/687c869ad54f499018ab0b038d3de4435c96d1dd
    // but leaving here as a failsafe.
    var schema = self.schema[self.currentTable].attributes[key] || {};
    if(hop(schema, 'collection')) return;
    selectKeys.push({ table: self.currentTable, key: schema.columnName || key });
  });

  // Add any hasFK strategy joins to the main query
  _.keys(queryObject.instructions).forEach(function(attr) {

    var strategy = queryObject.instructions[attr].strategy.strategy;
    if(strategy !== 1) return;

    var population = queryObject.instructions[attr].instructions[0];

    // Handle hasFK
    var childAlias = _.find(_.values(self.schema), {tableName: population.child}).tableName;

    _.keys(self.schema[childAlias].attributes).forEach(function(key) {
      var schema = self.schema[childAlias].attributes[key];
      if(hop(schema, 'collection')) return;
      selectKeys.push({ table: population.alias ? "__"+population.alias : population.child, key: schema.columnName || key, alias: population.parentKey });
    });
  });

  // Add all the columns to be selected
  selectKeys.forEach(function(select) {

    // If there is an alias, set it in the select (used for hasFK associations)
    if(select.alias) {
      query += utils.escapeName(select.table, self.escapeCharacter) + '.' + utils.escapeName(select.key, self.escapeCharacter) + ' AS ' + self.escapeCharacter + select.alias + '___' + select.key + self.escapeCharacter + ', ';
    }
    else {
      query += utils.escapeName(select.table, self.escapeCharacter) + '.' + utils.escapeName(select.key, self.escapeCharacter) + ', ';
    }

  });

  // Remove the last comma
  query = query.slice(0, -2) + ' FROM ' + tableName + ' AS ' + utils.escapeName(self.currentTable, self.escapeCharacter) + ' ';

  return query;
};


/**
 * Aggregates
 *
 */

SelectBuilder.prototype.processAggregates = function processAggregates(criteria) {

  var self = this;

  if(!criteria.groupBy && !criteria.sum && !criteria.average && !criteria.min && !criteria.max) {
    return false;
  }

  // Error if groupBy is used and no calculations are given
  if(!criteria.sum && !criteria.average && !criteria.min && !criteria.max) {
    throw new Error('An aggregation was used but no calculations were given');
  }


  var query = 'SELECT ';
  var tableName = utils.escapeName(this.currentTable, this.escapeCharacter);

  // Append groupBy columns to select statement
  if(criteria.groupBy) {
    if(Array.isArray(criteria.groupBy)) {
      criteria.groupBy.forEach(function(opt) {
        query += tableName + '.' + utils.escapeName(opt, self.escapeCharacter) + ', ';
      });

    } else {
      query += tableName + '.' + utils.escapeName(criteria.groupBy, self.escapeCharacter) + ', ';
    }
  }

  // Handle SUM
  if (criteria.sum) {
    var sum = '';
    if(Array.isArray(criteria.sum)) {
      criteria.sum.forEach(function(opt) {
        sum = 'SUM(' + tableName + '.' + utils.escapeName(opt, self.escapeCharacter) + ')';
        if(self.cast) {
          sum = 'CAST(' + sum + ' AS float)';
        }
        query += sum + ' AS ' + utils.escapeName(opt, self.escapeCharacter) + ', ';
      });

    } else {
      sum = 'SUM(' + tableName + '.' + utils.escapeName(criteria.sum, self.escapeCharacter) + ')';
      if(self.cast) {
        sum = 'CAST(' + sum + ' AS float)';
      }
      query += sum + ' AS ' + utils.escapeName(criteria.sum, self.escapeCharacter) + ', ';
    }
  }

  // Handle AVG (casting to float to fix percision with trailing zeros)
  if (criteria.average) {
    var avg = '';
    if(Array.isArray(criteria.average)) {
      criteria.average.forEach(function(opt){

        field = tableName + '.' + utils.escapeName(opt, self.escapeCharacter);
        field = self.cast ? 'CAST(' + field + ' AS Float)' : field;

        avg = 'AVG(' + field + ')';

        query +=  avg + ' AS ' + utils.escapeName(opt, self.escapeCharacter) + ', ';
      });
    } else {
      field = tableName + '.' + utils.escapeName(criteria.average, self.escapeCharacter);
      field = self.cast ? 'CAST(' + field + ' AS Float)' : field;

      avg = 'AVG(' + field + ')';

      query += avg + ' AS ' + utils.escapeName(criteria.average, self.escapeCharacter) + ', ';
    }
  }

  // Handle MAX
  if (criteria.max) {
    var max = '';
    if(Array.isArray(criteria.max)) {
      criteria.max.forEach(function(opt){
        query += 'MAX(' + tableName + '.' + utils.escapeName(opt, self.escapeCharacter) + ') AS ' + utils.escapeName(opt, self.escapeCharacter) + ', ';
      });

    } else {
      query += 'MAX(' + tableName + '.' + utils.escapeName(criteria.max, self.escapeCharacter) + ') AS ' + utils.escapeName(criteria.max, self.escapeCharacter) + ', ';
    }
  }

  // Handle MIN
  if (criteria.min) {
    if(Array.isArray(criteria.min)) {
      criteria.min.forEach(function(opt){
        query += 'MIN(' + tableName + '.' + utils.escapeName(opt, self.escapeCharacter) + ') AS ' + utils.escapeName(opt, self.escapeCharacter) + ', ';
      });

    } else {
      query += 'MIN(' + tableName + '.' + utils.escapeName(criteria.min, self.escapeCharacter) + ') AS ' + utils.escapeName(criteria.min, self.escapeCharacter) + ', ';
    }
  }

  // trim trailing comma
  query = query.slice(0, -2) + ' ';

  // Add FROM clause
  query += 'FROM ' + utils.escapeName(self.schema[self.currentTable].tableName, self.escapeCharacter) + ' AS ' + tableName + ' ';
  return query;
};
